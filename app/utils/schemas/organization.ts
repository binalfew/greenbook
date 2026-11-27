import { z } from "zod/v4";

/** The tenant's name and contact details, edited on the General settings page. */
export const contactInfoSchema = z.object({
  name: z.string({ error: "Name is required" }).min(1, "Name is required").max(200),
  email: z.email("Valid email is required"),
  phone: z.string({ error: "Phone is required" }).min(1, "Phone is required"),
});
