import closeWithGrace from "close-with-grace";
import { setupServer } from "msw/node";
import { handlers as resendHandlers } from "./resend.ts";

export const server = setupServer(...resendHandlers);

server.listen({
  onUnhandledRequest(request, print) {
    // React-router-devtools send custom requests internally to handle some functionality, we ignore those
    if (request.url.includes("__rrdt")) {
      return;
    }
    // Print the regular MSW unhandled request warning otherwise.
    print.warning();
  },
});

console.info("🔶 Mock server installed");

closeWithGrace(() => {
  server.close();
});
