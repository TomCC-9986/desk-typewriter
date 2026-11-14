// dt-ble.exe: Bluetooth LE transport for 桌面打字机 on Windows 10/11 (WinRT). Same JSON-lines protocol and the same
// GATT layout as the macOS helper (native/ble/main.swift), so a Mac and a PC can pass notes to each other.
using System.Collections.Concurrent;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

static class P {
  static readonly Guid SVC = Guid.Parse("6E2B0001-1F3D-4A8B-9C5E-0D7A1B2C3D4E");
  static readonly Guid INFO = Guid.Parse("6E2B0002-1F3D-4A8B-9C5E-0D7A1B2C3D4E");
  static readonly Guid INBOX = Guid.Parse("6E2B0003-1F3D-4A8B-9C5E-0D7A1B2C3D4E");
  static readonly Guid REPLY = Guid.Parse("6E2B0004-1F3D-4A8B-9C5E-0D7A1B2C3D4E");
  static readonly object outLock = new();
  static byte[] info = Encoding.UTF8.GetBytes("{}");
  // peripheral state, per connected central
  static readonly ConcurrentDictionary<string, MemoryStream> buffers = new();
  static readonly ConcurrentDictionary<string, byte[]> replies = new();
  static readonly ConcurrentDictionary<string, TaskCompletionSource<byte[]>> waitingReads = new();
  static readonly ConcurrentDictionary<int, string> replyFor = new();
  static int nextIncoming = 1;
  // central state
  static readonly ConcurrentDictionary<ulong, DateTime> infoAt = new();
  static readonly SemaphoreSlim centralLock = new(1, 1);
  static GattServiceProvider? provider;
  static BluetoothLEAdvertisementWatcher? watcher;

  static void Emit(object o) { var s = JsonSerializer.Serialize(o); lock (outLock) { Console.Out.WriteLine(s); Console.Out.Flush(); } }
  static string Dev(ulong a) => a.ToString("X12");
  static IBuffer Buf(byte[] b) => b.AsBuffer();
  static byte[] Bytes(IBuffer b) { var r = DataReader.FromBuffer(b); var a = new byte[b.Length]; r.ReadBytes(a); return a; }

  static async Task Main() {
    Console.OutputEncoding = new UTF8Encoding(false);
    string? line;
    while ((line = await Console.In.ReadLineAsync()) != null) {
      JsonNode? o; try { o = JsonNode.Parse(line); } catch { continue; }
      var cmd = (string?)o?["cmd"];
      try {
        switch (cmd) {
          case "start": info = Encoding.UTF8.GetBytes((string?)o!["info"] ?? "{}"); _ = Start(); break;
          case "info": info = Encoding.UTF8.GetBytes((string?)o!["info"] ?? "{}"); break;
          case "send": _ = Send((int?)o!["req"] ?? 0, (string?)o["peer"] ?? "", (string?)o["data"] ?? ""); break;
          case "reply": Reply((int?)o!["req"] ?? 0, (string?)o["data"] ?? "{}"); break;
          case "stop": Environment.Exit(0); break;
        }
      } catch (Exception e) { Emit(new { ev = "error", where = cmd, error = e.Message }); }
    }
    Environment.Exit(0);   // parent went away
  }

  static async Task Start() {
    var adapter = await BluetoothAdapter.GetDefaultAsync();
    if (adapter == null || !adapter.IsLowEnergySupported) { Emit(new { ev = "state", state = "unsupported" }); return; }
    var radio = await adapter.GetRadioAsync();
    Emit(new { ev = "state", state = radio?.State == Windows.Devices.Radios.RadioState.On ? "on" : "off" });
    if (radio != null) radio.StateChanged += (r, _) => Emit(new { ev = "state", state = r.State == Windows.Devices.Radios.RadioState.On ? "on" : "off" });
    // ---- peripheral (needs adapter.IsPeripheralRoleSupported)
    if (adapter.IsPeripheralRoleSupported) {
      var res = await GattServiceProvider.CreateAsync(SVC);
      if (res.Error == BluetoothError.Success) {
        provider = res.ServiceProvider;
        var rd = new GattLocalCharacteristicParameters { CharacteristicProperties = GattCharacteristicProperties.Read, ReadProtectionLevel = GattProtectionLevel.Plain };
        var wr = new GattLocalCharacteristicParameters { CharacteristicProperties = GattCharacteristicProperties.Write, WriteProtectionLevel = GattProtectionLevel.Plain };
        var cInfo = (await provider.Service.CreateCharacteristicAsync(INFO, rd)).Characteristic;
        var cInbox = (await provider.Service.CreateCharacteristicAsync(INBOX, wr)).Characteristic;
        var cReply = (await provider.Service.CreateCharacteristicAsync(REPLY, rd)).Characteristic;
        cInfo.ReadRequested += async (s, a) => { var d = a.GetDeferral(); var r = await a.GetRequestAsync(); r?.RespondWithValue(Buf(Slice(info, (int)(r?.Offset ?? 0)))); d.Complete(); };
        cInbox.WriteRequested += async (s, a) => {
          var d = a.GetDeferral();
          try {
            var r = await a.GetRequestAsync(); if (r == null) return;
            var who = a.Session.DeviceId.Id; var v = Bytes(r.Value);
            if (v.Length > 0) {
              var ms = buffers.GetOrAdd(who, _ => new MemoryStream());
              ms.Write(v, 1, v.Length - 1);
              if (ms.Length > 64 * 1024) ms.SetLength(0);
              if ((v[0] & 1) == 1) {
                buffers.TryRemove(who, out _); replies.TryRemove(who, out _);
                var req = Interlocked.Increment(ref nextIncoming);
                replyFor[req] = who;
                Emit(new { ev = "msg", req, data = Encoding.UTF8.GetString(ms.ToArray()) });
              }
            }
            if (r.Option == GattWriteOption.WriteWithResponse) r.Respond();
          } finally { d.Complete(); }
        };
        cReply.ReadRequested += async (s, a) => {
          var d = a.GetDeferral();
          try {
            var r = await a.GetRequestAsync(); if (r == null) return;
            var who = a.Session.DeviceId.Id;
            byte[] v;
            if (!replies.TryGetValue(who, out v!)) {   // hold the read until the app has decided
              var tcs = waitingReads.GetOrAdd(who, _ => new TaskCompletionSource<byte[]>());
              var done = await Task.WhenAny(tcs.Task, Task.Delay(20000));
              waitingReads.TryRemove(who, out _);
              v = done == tcs.Task ? tcs.Task.Result : Encoding.UTF8.GetBytes("{\"ok\":false,\"reason\":\"timeout\"}");
              replies[who] = v;
            }
            var part = Slice(v, (int)r.Offset);
            r.RespondWithValue(Buf(part));
            if (r.Offset + part.Length >= v.Length) replies.TryRemove(who, out _);
          } finally { d.Complete(); }
        };
        provider.StartAdvertising(new GattServiceProviderAdvertisingParameters { IsConnectable = true, IsDiscoverable = true });
        Emit(new { ev = "advertising" });
      } else Emit(new { ev = "error", where = "provider", error = res.Error.ToString() });
    } else Emit(new { ev = "error", where = "provider", error = "peripheral_role_unsupported" });
    // ---- central
    watcher = new BluetoothLEAdvertisementWatcher { ScanningMode = BluetoothLEScanningMode.Active };
    watcher.AdvertisementFilter.Advertisement.ServiceUuids.Add(SVC);
    watcher.Received += (w, a) => {
      Emit(new { ev = "seen", peer = Dev(a.BluetoothAddress), rssi = (int)a.RawSignalStrengthInDBm });
      var stale = !infoAt.TryGetValue(a.BluetoothAddress, out var t) || (DateTime.UtcNow - t).TotalSeconds > 60;
      if (stale) { infoAt[a.BluetoothAddress] = DateTime.UtcNow; _ = ReadInfo(a.BluetoothAddress); }
    };
    watcher.Start();
  }

  static byte[] Slice(byte[] b, int off) => off >= b.Length ? Array.Empty<byte>() : b[off..];

  static void Reply(int req, string data) {
    if (!replyFor.TryRemove(req, out var who)) return;
    var v = Encoding.UTF8.GetBytes(data);
    if (waitingReads.TryGetValue(who, out var tcs)) tcs.TrySetResult(v); else replies[who] = v;
  }

  static async Task<(BluetoothLEDevice dev, GattDeviceService svc)?> Connect(ulong addr) {
    var dev = await BluetoothLEDevice.FromBluetoothAddressAsync(addr);
    if (dev == null) return null;
    var sr = await dev.GetGattServicesForUuidAsync(SVC, BluetoothCacheMode.Uncached);
    if (sr.Status != GattCommunicationStatus.Success || sr.Services.Count == 0) { dev.Dispose(); return null; }
    return (dev, sr.Services[0]);
  }
  static async Task<GattCharacteristic?> Char(GattDeviceService s, Guid id) {
    var r = await s.GetCharacteristicsForUuidAsync(id, BluetoothCacheMode.Uncached);
    return r.Status == GattCommunicationStatus.Success && r.Characteristics.Count > 0 ? r.Characteristics[0] : null;
  }
  static async Task<byte[]?> ReadAll(GattCharacteristic c) {
    var r = await c.ReadValueAsync(BluetoothCacheMode.Uncached);   // WinRT does the long read (offsets) itself
    return r.Status == GattCommunicationStatus.Success ? Bytes(r.Value) : null;
  }

  static async Task ReadInfo(ulong addr) {
    await centralLock.WaitAsync();
    try {
      var c = await Connect(addr); if (c == null) { infoAt.TryRemove(addr, out _); return; }
      using var dev = c.Value.dev; using var svc = c.Value.svc;
      var ch = await Char(svc, INFO); var v = ch == null ? null : await ReadAll(ch);
      if (v != null) Emit(new { ev = "peer", peer = Dev(addr), info = Encoding.UTF8.GetString(v) });
      else infoAt.TryRemove(addr, out _);
    } catch { infoAt.TryRemove(addr, out _); } finally { centralLock.Release(); }
  }

  static async Task Send(int req, string peer, string data) {
    if (!ulong.TryParse(peer, System.Globalization.NumberStyles.HexNumber, null, out var addr)) { Emit(new { ev = "sent", req, error = "not_nearby" }); return; }
    await centralLock.WaitAsync();
    try {
      var c = await Connect(addr); if (c == null) { Emit(new { ev = "sent", req, error = "not_nearby" }); return; }
      using var dev = c.Value.dev; using var svc = c.Value.svc;
      var inbox = await Char(svc, INBOX); var reply = await Char(svc, REPLY);
      if (inbox == null || reply == null) { Emit(new { ev = "sent", req, error = "no_service" }); return; }
      int room = 180;
      try { var sess = await GattSession.FromDeviceIdAsync(dev.BluetoothDeviceId); room = Math.Max(20, Math.Min(509, sess.MaxPduSize - 3) - 1); } catch { }
      var bytes = Encoding.UTF8.GetBytes(data);
      for (int i = 0; ;) {
        int end = Math.Min(bytes.Length, i + room);
        var chunk = new byte[end - i + 1]; chunk[0] = (byte)(end >= bytes.Length ? 1 : 0); Array.Copy(bytes, i, chunk, 1, end - i);
        var st = await inbox.WriteValueWithResultAsync(Buf(chunk), GattWriteOption.WriteWithResponse);
        if (st.Status != GattCommunicationStatus.Success) { Emit(new { ev = "sent", req, error = "write_failed" }); return; }
        i = end; if (i >= bytes.Length) break;
      }
      var v = await ReadAll(reply);
      if (v == null) Emit(new { ev = "sent", req, error = "read_failed" });
      else Emit(new { ev = "sent", req, reply = Encoding.UTF8.GetString(v) });
    } catch (Exception e) { Emit(new { ev = "sent", req, error = e.Message }); } finally { centralLock.Release(); }
  }
}
