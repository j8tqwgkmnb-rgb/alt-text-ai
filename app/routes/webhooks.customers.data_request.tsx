import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook — no customer data stored`);
  return new Response(null, { status: 200 });
};
