import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Thumbnail,
  Badge,
  Box,
  Divider,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { generateAltText } from "../services/claude.server";
import { getOrCreateSubscription, createSubscriptionUrl } from "../services/billing.server";
import { getUsage, incrementUsage, canGenerate, remainingQuota } from "../services/usage.server";

interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
  productId: string;
  productTitle: string;
}

const PRODUCTS_QUERY = `#graphql
  query getProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      edges {
        node {
          id
          title
          media(first: 20) {
            edges {
              node {
                ... on MediaImage {
                  id
                  alt
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [productsResponse, subscription] = await Promise.all([
    admin.graphql(PRODUCTS_QUERY),
    getOrCreateSubscription(admin),
  ]);

  const data = await productsResponse.json();
  const isPro = !!subscription;

  const images: ProductImage[] = [];
  let totalImages = 0;
  let missingAlt = 0;

  for (const edge of data.data.products.edges) {
    const product = edge.node;
    for (const mediaEdge of product.media.edges) {
      const media = mediaEdge.node;
      if (media.image) {
        totalImages++;
        const altText = media.alt || media.image.altText || null;
        if (!altText) missingAlt++;
        images.push({
          id: media.id,
          url: media.image.url,
          altText,
          productId: product.id,
          productTitle: product.title,
        });
      }
    }
  }

  const usage = await getUsage(shop);
  const remaining = await remainingQuota(shop, isPro);

  return json({ images, totalImages, missingAlt, isPro, usage, remaining });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "subscribe") {
    const confirmationUrl = await createSubscriptionUrl(admin, shop);
    return json({ redirect: confirmationUrl });
  }

  const subscription = await getOrCreateSubscription(admin);
  const isPro = !!subscription;

  if (intent === "generate") {
    const allowed = await canGenerate(shop, isPro);
    if (!allowed) {
      return json({ success: false, error: "Monthly limit reached. Upgrade to Pro for unlimited." }, { status: 403 });
    }

    const imageId = formData.get("imageId") as string;
    const imageUrl = formData.get("imageUrl") as string;
    const productId = formData.get("productId") as string;
    const productTitle = formData.get("productTitle") as string;

    try {
      const altText = await generateAltText(imageUrl, productTitle);

      await admin.graphql(
        `#graphql
        mutation updateMediaAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
          productUpdateMedia(productId: $productId, media: $media) {
            media {
              ... on MediaImage {
                id
                alt
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            productId,
            media: [{ id: imageId, alt: altText }],
          },
        },
      );

      await incrementUsage(shop);
      return json({ success: true, imageId, altText });
    } catch (error: any) {
      return json({ success: false, imageId, error: error.message }, { status: 500 });
    }
  }

  if (intent === "generate_all") {
    const imagesJson = formData.get("images") as string;
    const imagesToProcess: ProductImage[] = JSON.parse(imagesJson);
    const remaining = await remainingQuota(shop, isPro);

    const limit = isPro ? imagesToProcess.length : Math.min(imagesToProcess.length, remaining);
    const batch = imagesToProcess.slice(0, limit);
    const results: { imageId: string; altText?: string; error?: string }[] = [];

    for (const img of batch) {
      try {
        const altText = await generateAltText(img.url, img.productTitle);

        await admin.graphql(
          `#graphql
          mutation updateMediaAlt($productId: ID!, $media: [UpdateMediaInput!]!) {
            productUpdateMedia(productId: $productId, media: $media) {
              media {
                ... on MediaImage {
                  id
                  alt
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              productId: img.productId,
              media: [{ id: img.id, alt: altText }],
            },
          },
        );

        await incrementUsage(shop);
        results.push({ imageId: img.id, altText });
      } catch (error: any) {
        results.push({ imageId: img.id, error: error.message });
      }
    }

    const skipped = imagesToProcess.length - batch.length;
    return json({ success: true, bulk: true, results, skipped });
  }

  return json({ success: false, error: "Unknown intent" }, { status: 400 });
};

export default function Index() {
  const { images, totalImages, missingAlt, isPro, usage, remaining } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<any>();
  const shopify = useAppBridge();
  const [generatedAlts, setGeneratedAlts] = useState<Record<string, string>>({});
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  const isGenerating = fetcher.state !== "idle";

  // Handle redirect for subscription
  useEffect(() => {
    if (fetcher.data?.redirect) {
      open(fetcher.data.redirect, "_top");
    }
  }, [fetcher.data]);

  // Handle fetcher response
  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      if (fetcher.data.bulk && fetcher.data.results) {
        const newAlts: Record<string, string> = {};
        for (const r of fetcher.data.results) {
          if (r.altText) newAlts[r.imageId] = r.altText;
        }
        setGeneratedAlts((prev) => ({ ...prev, ...newAlts }));
        setBulkRunning(false);
        setGeneratingIds(new Set());
        if (fetcher.data.skipped > 0) {
          shopify.toast.show(`${fetcher.data.results.length} generated, ${fetcher.data.skipped} skipped (limit reached)`);
        } else {
          shopify.toast.show(`${fetcher.data.results.length} alt texts generated`);
        }
      } else if (fetcher.data.imageId && fetcher.data.altText) {
        setGeneratedAlts((prev) => ({ ...prev, [fetcher.data.imageId]: fetcher.data.altText }));
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(fetcher.data.imageId);
          return next;
        });
        shopify.toast.show("Alt text generated");
      } else if (fetcher.data.error) {
        shopify.toast.show(fetcher.data.error, { isError: true });
        setGeneratingIds(new Set());
        setBulkRunning(false);
      }
    }
  }, [fetcher.data, fetcher.state, shopify]);

  const handleGenerate = useCallback(
    (img: ProductImage) => {
      setGeneratingIds((prev) => new Set(prev).add(img.id));
      fetcher.submit(
        {
          intent: "generate",
          imageId: img.id,
          imageUrl: img.url,
          productId: img.productId,
          productTitle: img.productTitle,
        },
        { method: "POST" },
      );
    },
    [fetcher],
  );

  const handleGenerateAll = useCallback(() => {
    const missing = images.filter((img) => !img.altText && !generatedAlts[img.id]);
    if (missing.length === 0) return;
    setBulkRunning(true);
    fetcher.submit(
      { intent: "generate_all", images: JSON.stringify(missing) },
      { method: "POST" },
    );
  }, [images, generatedAlts, fetcher]);

  const handleSubscribe = useCallback(() => {
    fetcher.submit({ intent: "subscribe" }, { method: "POST" });
  }, [fetcher]);

  const currentMissing = images.filter(
    (img) => !img.altText && !generatedAlts[img.id],
  ).length;
  const compliancePercent =
    totalImages > 0 ? Math.round(((totalImages - currentMissing) / totalImages) * 100) : 100;

  return (
    <Page>
      <TitleBar title="Alt Text AI" />
      <BlockStack gap="500">
        <Layout>
          {/* Stats */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Image Accessibility Overview</Text>
                  <Badge tone={isPro ? "success" : "info"}>{isPro ? "Pro" : "Free"}</Badge>
                </InlineStack>
                <InlineStack gap="800">
                  <BlockStack gap="100">
                    <Text as="p" variant="headingLg">{totalImages}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Total images</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="headingLg" tone={currentMissing > 0 ? "critical" : "success"}>
                      {currentMissing}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">Missing alt text</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="headingLg">{compliancePercent}%</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Compliant</Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="headingLg">{isPro ? "Unlimited" : `${remaining}`}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Remaining this month</Text>
                  </BlockStack>
                </InlineStack>
                <ProgressBar progress={compliancePercent} tone={compliancePercent === 100 ? "success" : "highlight"} size="small" />
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Upgrade banner for free users */}
          {!isPro && remaining <= 10 && (
            <Layout.Section>
              <Banner
                title={remaining === 0 ? "Monthly limit reached" : `Only ${remaining} generations remaining`}
                tone="warning"
                action={{ content: "Upgrade to Pro — $9.99/mo", onAction: handleSubscribe }}
              >
                <Text as="p" variant="bodyMd">
                  Upgrade to Pro for unlimited AI alt text generation.
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {/* Warning banner for missing alt text */}
          {currentMissing > 0 && (remaining > 0 || isPro) && (
            <Layout.Section>
              <Banner
                title={`${currentMissing} image${currentMissing !== 1 ? "s" : ""} missing alt text`}
                tone="warning"
                action={{
                  content: `Generate all (${Math.min(currentMissing, isPro ? currentMissing : remaining)})`,
                  onAction: handleGenerateAll,
                  loading: bulkRunning,
                }}
              >
                <Text as="p" variant="bodyMd">
                  Missing alt text violates WCAG 2.1 SC 1.1.1 and can expose your store to ADA lawsuits.
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {currentMissing === 0 && totalImages > 0 && (
            <Layout.Section>
              <Banner title="All images have alt text" tone="success">
                <Text as="p" variant="bodyMd">
                  Your store is compliant with WCAG 2.1 Success Criterion 1.1.1 for image alt text.
                </Text>
              </Banner>
            </Layout.Section>
          )}

          {/* Image list */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Product Images</Text>
                {images.length === 0 && (
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No product images found. Add images to your products to get started.
                  </Text>
                )}
                {images.map((img, i) => {
                  const currentAlt = generatedAlts[img.id] || img.altText;
                  const isThisGenerating = generatingIds.has(img.id);
                  return (
                    <div key={img.id}>
                      {i > 0 && <Divider />}
                      <Box paddingBlockStart="300" paddingBlockEnd="300">
                        <InlineStack gap="400" align="start" blockAlign="center" wrap={false}>
                          <Thumbnail source={img.url} alt={currentAlt || ""} size="medium" />
                          <BlockStack gap="100">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {img.productTitle}
                            </Text>
                            {currentAlt ? (
                              <InlineStack gap="200" blockAlign="center">
                                <Badge tone="success">Has alt text</Badge>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {currentAlt}
                                </Text>
                              </InlineStack>
                            ) : (
                              <InlineStack gap="200" blockAlign="center">
                                <Badge tone="critical">Missing</Badge>
                                <Button
                                  size="slim"
                                  onClick={() => handleGenerate(img)}
                                  loading={isThisGenerating}
                                  disabled={isGenerating || (!isPro && remaining <= 0)}
                                >
                                  Generate
                                </Button>
                              </InlineStack>
                            )}
                          </BlockStack>
                        </InlineStack>
                      </Box>
                    </div>
                  );
                })}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
