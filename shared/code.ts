export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const cryptoRand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

export function generateCode(rand: (n: number) => number = cryptoRand): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[rand(CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== 6 || [...s].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}
