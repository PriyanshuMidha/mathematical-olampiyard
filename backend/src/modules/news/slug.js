import slugify from "slugify";

export function makeSlug(value) {
  return slugify(value, { lower: true, strict: true, trim: true });
}
