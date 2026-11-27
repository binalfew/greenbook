let seq = 0;

/**
 * The contact fields the person form requires. Each call returns a different
 * email, so two forms never look like the same person by email.
 */
export function personContactFields() {
  seq += 1;
  return {
    email: `person${seq}@au.example`,
    phone: "+251 11 551 7700",
    officeEmail: `office${seq}@au.example`,
    officePhone: "+251 11 551 7701",
  };
}
