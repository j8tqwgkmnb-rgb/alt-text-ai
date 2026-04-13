import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateAltText(imageUrl: string, productTitle: string): Promise<string> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url: imageUrl },
          },
          {
            type: "text",
            text: `Write a concise, descriptive alt text for this product image. The product is: "${productTitle}".

Requirements:
- Describe what is visually shown (color, shape, material, context)
- Keep it under 125 characters
- Do not start with "Image of" or "Photo of"
- Do not include the product title verbatim — describe what you see
- Be specific enough for a visually impaired user to understand the product

Return ONLY the alt text, nothing else.`,
          },
        ],
      },
    ],
  });

  const block = response.content[0];
  if (block.type === "text") {
    return block.text.trim();
  }
  throw new Error("Unexpected response format from Claude");
}
