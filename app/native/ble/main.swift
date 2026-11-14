// dt-ble: Bluetooth LE transport for 桌面打字机 (macOS, CoreBluetooth).
// Runs as a child process of the app and speaks JSON lines on stdin/stdout.
//
// Every machine is both a peripheral (advertises our service; peers write notes into it) and a central (scans for
// the service, connects on demand, writes messages, reads the verdict).
//
// GATT service SVC:
//   INFO  (read)  -> JSON {"id","nickname"} of this machine
//   INBOX (write) -> message chunks: 1 header byte (bit0 = last chunk) + payload; reassembled per central
//   REPLY (read)  -> the receiver's verdict for the last message from this central (read is held until it is known)
//
// stdin  {"cmd":"start","info":"<json>"} | {"cmd":"info","info":"<json>"} | {"cmd":"send","req":1,"peer":"<uuid>","data":"<json>"}
//        {"cmd":"reply","req":7,"data":"<json>"} | {"cmd":"stop"}
// stdout {"ev":"state","state":"on|off|unauthorized|unsupported|resetting|unknown"}
//        {"ev":"seen","peer":"<uuid>","rssi":-60}           (advertisement seen; info may be stale)
//        {"ev":"peer","peer":"<uuid>","info":"<json>"}       (info read)
//        {"ev":"msg","req":7,"data":"<json>"}               (complete incoming message: answer with cmd reply)
//        {"ev":"sent","req":1,"reply":"<json>"} | {"ev":"sent","req":1,"error":"..."}
import CoreBluetooth
import Foundation

let SVC = CBUUID(string: "6E2B0001-1F3D-4A8B-9C5E-0D7A1B2C3D4E")
let INFO = CBUUID(string: "6E2B0002-1F3D-4A8B-9C5E-0D7A1B2C3D4E")
let INBOX = CBUUID(string: "6E2B0003-1F3D-4A8B-9C5E-0D7A1B2C3D4E")
let REPLY = CBUUID(string: "6E2B0004-1F3D-4A8B-9C5E-0D7A1B2C3D4E")

func emit(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
  FileHandle.standardOutput.write((s + "\n").data(using: .utf8)!)
}
func stateName(_ s: CBManagerState) -> String {
  switch s {
  case .poweredOn: return "on"; case .poweredOff: return "off"; case .unauthorized: return "unauthorized"
  case .unsupported: return "unsupported"; case .resetting: return "resetting"; default: return "unknown"
  }
}

struct Job { let req: Int; let peer: UUID; let data: Data?; let infoOnly: Bool }

final class Ble: NSObject, CBPeripheralManagerDelegate, CBCentralManagerDelegate, CBPeripheralDelegate {
  var pm: CBPeripheralManager!
  var cm: CBCentralManager!
  var info = Data("{}".utf8)
  var started = false
  // peripheral side
  var buffers: [UUID: Data] = [:]
  var replies: [UUID: Data] = [:]
  var heldReads: [UUID: CBATTRequest] = [:]
  var pendingReplyFor: [Int: UUID] = [:]
  var nextIncoming = 1
  // central side
  var known: [UUID: CBPeripheral] = [:]
  var infoAt: [UUID: Date] = [:]
  var queue: [Job] = []
  var job: Job?
  var conn: CBPeripheral?
  var chars: [CBUUID: CBCharacteristic] = [:]
  var chunks: [Data] = []
  var timer: Timer?

  func start(_ infoJSON: String) {
    info = Data(infoJSON.utf8)
    if started { return }
    started = true
    pm = CBPeripheralManager(delegate: self, queue: nil)
    cm = CBCentralManager(delegate: self, queue: nil)
  }

  // MARK: peripheral
  func peripheralManagerDidUpdateState(_ p: CBPeripheralManager) {
    emit(["ev": "state", "state": stateName(p.state), "role": "peripheral"])
    guard p.state == .poweredOn else { return }
    let s = CBMutableService(type: SVC, primary: true)
    s.characteristics = [
      CBMutableCharacteristic(type: INFO, properties: [.read], value: nil, permissions: [.readable]),
      CBMutableCharacteristic(type: INBOX, properties: [.write], value: nil, permissions: [.writeable]),
      CBMutableCharacteristic(type: REPLY, properties: [.read], value: nil, permissions: [.readable]),
    ]
    p.removeAllServices()
    p.add(s)
  }
  func peripheralManager(_ p: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    if let e = error { emit(["ev": "error", "where": "addService", "error": e.localizedDescription]); return }
    p.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [SVC], CBAdvertisementDataLocalNameKey: "DeskTW"])
  }
  func peripheralManagerDidStartAdvertising(_ p: CBPeripheralManager, error: Error?) {
    if let e = error { emit(["ev": "error", "where": "advertise", "error": e.localizedDescription]) }
    else { emit(["ev": "advertising"]) }
  }
  func peripheralManager(_ p: CBPeripheralManager, didReceiveRead r: CBATTRequest) {
    let who = r.central.identifier
    if r.characteristic.uuid == INFO {
      guard r.offset <= info.count else { p.respond(to: r, withResult: .invalidOffset); return }
      r.value = info.subdata(in: r.offset..<info.count); p.respond(to: r, withResult: .success)
    } else if r.characteristic.uuid == REPLY {
      if let v = replies[who] {
        guard r.offset <= v.count else { p.respond(to: r, withResult: .invalidOffset); return }
        r.value = v.subdata(in: r.offset..<v.count); p.respond(to: r, withResult: .success)
        if r.offset + min(v.count - r.offset, r.central.maximumUpdateValueLength) >= v.count { replies[who] = nil }
      } else {
        heldReads[who] = r   // verdict not known yet: answer when the app replies
      }
    } else { p.respond(to: r, withResult: .attributeNotFound) }
  }
  func peripheralManager(_ p: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for r in requests where r.characteristic.uuid == INBOX {
      guard let v = r.value, !v.isEmpty else { continue }
      let who = r.central.identifier
      var buf = buffers[who] ?? Data()
      buf.append(v.dropFirst())
      if buf.count > 64 * 1024 { buf = Data() }            // garbage guard
      if v[v.startIndex] & 1 == 1 {
        buffers[who] = nil
        replies[who] = nil
        let req = nextIncoming; nextIncoming += 1
        pendingReplyFor[req] = who
        emit(["ev": "msg", "req": req, "data": String(decoding: buf, as: UTF8.self)])
      } else { buffers[who] = buf }
    }
    if let first = requests.first { p.respond(to: first, withResult: .success) }
  }
  func reply(_ req: Int, _ data: String) {
    guard let who = pendingReplyFor.removeValue(forKey: req) else { return }
    let v = Data(data.utf8)
    if let r = heldReads.removeValue(forKey: who) {
      r.value = v; pm.respond(to: r, withResult: .success)
    } else { replies[who] = v }
  }

  // MARK: central
  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    emit(["ev": "state", "state": stateName(c.state), "role": "central"])
    guard c.state == .poweredOn else { return }
    c.scanForPeripherals(withServices: [SVC], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
  }
  func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
    known[p.identifier] = p
    emit(["ev": "seen", "peer": p.identifier.uuidString, "rssi": rssi.intValue])
    let stale = infoAt[p.identifier].map { Date().timeIntervalSince($0) > 60 } ?? true
    if stale && !queue.contains(where: { $0.peer == p.identifier && $0.infoOnly }) && job?.peer != p.identifier {
      infoAt[p.identifier] = Date()   // don't queue it again while this read is pending
      enqueue(Job(req: 0, peer: p.identifier, data: nil, infoOnly: true))
    }
  }
  func send(_ req: Int, _ peer: String, _ data: String) {
    guard let id = UUID(uuidString: peer), known[id] != nil else { emit(["ev": "sent", "req": req, "error": "not_nearby"]); return }
    enqueue(Job(req: req, peer: id, data: Data(data.utf8), infoOnly: false))
  }
  func enqueue(_ j: Job) { queue.append(j); pump() }
  func pump() {
    guard job == nil, !queue.isEmpty, cm.state == .poweredOn else { return }
    let j = queue.removeFirst(); job = j
    guard let p = known[j.peer] else { finish(error: "not_nearby"); return }
    conn = p; chars = [:]
    p.delegate = self
    timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in self?.finish(error: "timeout") }
    cm.connect(p, options: nil)
  }
  func finish(reply: Data? = nil, error: String? = nil) {
    timer?.invalidate(); timer = nil
    if let j = job, !j.infoOnly {
      if let e = error { emit(["ev": "sent", "req": j.req, "error": e]) }
      else { emit(["ev": "sent", "req": j.req, "reply": String(decoding: reply ?? Data(), as: UTF8.self)]) }
    }
    if let p = conn { cm.cancelPeripheralConnection(p) }
    conn = nil; job = nil; chunks = []
    DispatchQueue.main.async { self.pump() }
  }
  func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) { p.discoverServices([SVC]) }
  func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) { if p == conn { finish(error: "connect_failed") } }
  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    if p == conn && job != nil { finish(error: "disconnected") }
  }
  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    guard let s = p.services?.first(where: { $0.uuid == SVC }) else { finish(error: "no_service"); return }
    p.discoverCharacteristics([INFO, INBOX, REPLY], for: s)
  }
  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
    for ch in s.characteristics ?? [] { chars[ch.uuid] = ch }
    guard let j = job else { return }
    if j.infoOnly {
      guard let ch = chars[INFO] else { finish(error: "no_info"); return }
      p.readValue(for: ch); return
    }
    guard let data = j.data, chars[INBOX] != nil else { finish(error: "no_inbox"); return }
    let room = max(20, p.maximumWriteValueLength(for: .withResponse) - 1)
    var parts: [Data] = []
    var i = 0
    repeat {
      let end = min(data.count, i + room)
      var c = Data([end >= data.count ? 1 : 0]); c.append(data.subdata(in: i..<end))
      parts.append(c); i = end
    } while i < data.count
    chunks = parts
    writeNext(p)
  }
  func writeNext(_ p: CBPeripheral) {
    guard let ch = chars[INBOX] else { return }
    if chunks.isEmpty {
      guard let r = chars[REPLY] else { finish(error: "no_reply"); return }
      p.readValue(for: r); return
    }
    p.writeValue(chunks.removeFirst(), for: ch, type: .withResponse)
  }
  func peripheral(_ p: CBPeripheral, didWriteValueFor ch: CBCharacteristic, error: Error?) {
    if let e = error { finish(error: "write_failed: \(e.localizedDescription)"); return }
    writeNext(p)
  }
  func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
    if let e = error { finish(error: "read_failed: \(e.localizedDescription)"); return }
    if ch.uuid == INFO {
      infoAt[p.identifier] = Date()
      emit(["ev": "peer", "peer": p.identifier.uuidString, "info": String(decoding: ch.value ?? Data(), as: UTF8.self)])
      finish()
    } else if ch.uuid == REPLY { finish(reply: ch.value) }
  }
}

let ble = Ble()
setvbuf(stdout, nil, _IOLBF, 0)
DispatchQueue.global().async {
  while let line = readLine() {
    guard let d = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let cmd = o["cmd"] as? String else { continue }
    DispatchQueue.main.async {
      switch cmd {
      case "start": ble.start(o["info"] as? String ?? "{}")
      case "info": ble.info = Data((o["info"] as? String ?? "{}").utf8)
      case "send": ble.send(o["req"] as? Int ?? 0, o["peer"] as? String ?? "", o["data"] as? String ?? "")
      case "reply": ble.reply(o["req"] as? Int ?? 0, o["data"] as? String ?? "{}")
      case "stop": exit(0)
      default: break
      }
    }
  }
  exit(0)   // parent went away
}
RunLoop.main.run()
