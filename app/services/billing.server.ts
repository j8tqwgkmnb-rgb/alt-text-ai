const FREE_LIMIT = 50; // images per month
const PRO_PLAN_NAME = "Pro";
const PRO_PLAN_PRICE = 9.99;

export { FREE_LIMIT, PRO_PLAN_NAME, PRO_PLAN_PRICE };

export async function getOrCreateSubscription(admin: any) {
  const response = await admin.graphql(`#graphql
    query {
      app {
        installation {
          activeSubscriptions {
            id
            name
            status
            test
          }
        }
      }
    }
  `);
  const data = await response.json();
  const subs = data.data.app.installation.activeSubscriptions;
  return subs.find((s: any) => s.name === PRO_PLAN_NAME && s.status === "ACTIVE") || null;
}

export async function createSubscriptionUrl(admin: any, shopDomain: string) {
  const returnUrl = `https://${shopDomain}/admin/apps/alt-text-ai`;

  const response = await admin.graphql(
    `#graphql
    mutation createSubscription($name: String!, $returnUrl: URL!, $amount: Decimal!, $interval: AppPricingInterval!) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        test: true
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
              price: { amount: $amount, currencyCode: USD }
              interval: $interval
            }
          }
        }]
      ) {
        appSubscription {
          id
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        name: PRO_PLAN_NAME,
        returnUrl,
        amount: PRO_PLAN_PRICE,
        interval: "EVERY_30_DAYS",
      },
    },
  );

  const result = await response.json();
  const { confirmationUrl, userErrors } = result.data.appSubscriptionCreate;

  if (userErrors?.length > 0) {
    throw new Error(userErrors.map((e: any) => e.message).join(", "));
  }

  return confirmationUrl;
}
