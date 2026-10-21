export function slugify(input: string): string {
  const withoutDiacritics = input
    .toLowerCase()
    .normalize("NFD")
    .split("")
    .filter((char) => char.codePointAt(0)! < 0x0300 || char.codePointAt(0)! > 0x036f)
    .join("");

  return withoutDiacritics.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");
}
