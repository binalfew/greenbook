import { z } from "zod";

const User = z.object({
  id: z.string(),
  email: z.string(),
});

export type User = z.infer<typeof User>;
