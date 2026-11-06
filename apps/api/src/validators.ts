import { z } from "zod";
import { plainString } from "./input-safety.js";
import { text } from "./domain.js";
export const memberSchema = z.object({
  name: text,
  document: z
    .string()
    .trim()
    .regex(/^\d{6,12}$/, "Documento de 6 a 12 dígitos"),
  email: plainString
    .transform((s) => s.toLowerCase())
    .pipe(z.union([z.email(), z.literal("")]))
    .default(""),
  phone: plainString.pipe(z.string().max(40)).default(""),
  notes: plainString.pipe(z.string().max(2000)).default(""),
  address: plainString.pipe(z.string().max(300)).default(""),
  emergency_name: plainString.pipe(z.string().max(180)).default(""),
  emergency_phone: plainString.pipe(z.string().max(40)).default(""),
  plan_ids: z.array(text).max(20).default([]),
});
