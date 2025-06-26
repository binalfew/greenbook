import { z } from "zod";

const User = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string().nullable(),
  name: z.string().nullable(),
  role: z.string(),
  isAdmin: z.boolean().optional(),
});

export type User = z.infer<typeof User>;
