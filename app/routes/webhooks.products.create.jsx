import { authenticate, sessionStorage } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Get the product ID from the webhook payload
    const productId = payload.id;
    const productGid = `gid://shopify/Product/${productId}`;
    
    console.log(`Processing new product: ${productGid}`);
    
    // Load offline session to get access token
    const sessionId = `offline_${shop}`;
    console.log("Loading session with ID:", sessionId);
    const session = await sessionStorage.loadSession(sessionId);
    
    if (!session) {
      console.error("No session found for shop:", shop);
      return new Response(null, { status: 200 });
    }
    
    console.log("Session loaded successfully");
    console.log("Session shop:", session.shop);
    console.log("Session isOnline:", session.isOnline);
    console.log("Access token exists:", !!session.accessToken);
    console.log("Access token (first 20 chars):", session.accessToken?.substring(0, 20) + "...");
    
    // Helper function to make authenticated GraphQL requests
    const graphqlRequest = async (query, variables) => {
      const response = await fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': session.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
      return await response.json();
    };
    
    // Fetch the default metafield values from database
    const defaults = await prisma.metafieldDefaults.findUnique({
      where: { shop },
    });
    
    if (!defaults) {
      console.log("No default metafield values found for this shop");
      return new Response(null, { status: 200 });
    }
    
    // Build metafields array from defaults
    const metafields = [];
    
    if (defaults.etsyDiscount) {
      metafields.push({
        namespace: "custom",
        key: "etsy_discount",
        value: defaults.etsyDiscount,
        type: "number_decimal"
      });
    }
    
    if (defaults.shipping) {
      metafields.push({
        namespace: "custom",
        key: "shipping",
        value: defaults.shipping,
        type: "number_decimal"
      });
    }
    
    if (defaults.vat) {
      metafields.push({
        namespace: "custom",
        key: "vat",
        value: defaults.vat,
        type: "number_decimal"
      });
    }
    
    if (defaults.normalMultiplier) {
      metafields.push({
        namespace: "custom",
        key: "normal_multiplier",
        value: defaults.normalMultiplier,
        type: "number_decimal"
      });
    }
    
    if (defaults.ooakMultiplier) {
      metafields.push({
        namespace: "custom",
        key: "ooak_multiplier",
        value: defaults.ooakMultiplier,
        type: "number_decimal"
      });
    }
    
    if (defaults.rarity) {
      metafields.push({
        namespace: "custom",
        key: "rarity",
        value: defaults.rarity,
        type: "single_line_text_field"
      });
    }
    
    if (defaults.etsyMarkupProfit) {
      metafields.push({
        namespace: "custom",
        key: "etsy_markup_profit",
        value: defaults.etsyMarkupProfit,
        type: "number_decimal"
      });
    }
    
    if (defaults.hourlyRate) {
      metafields.push({
        namespace: "custom",
        key: "hourly_rate",
        value: defaults.hourlyRate,
        type: "number_decimal"
      });
    }
    
    // If no metafields to set, return early
    if (metafields.length === 0) {
      console.log("No metafield values to apply");
      return new Response(null, { status: 200 });
    }
    
    console.log(`Applying ${metafields.length} metafields to product ${productGid}`);
    
    // Build metafields input for metafieldsSet mutation
    const metafieldsSetInput = metafields.map(mf => ({
      ownerId: productGid,
      namespace: mf.namespace,
      key: mf.key,
      value: mf.value,
      type: mf.type
    }));
    
    console.log("MetafieldsSet Input:", JSON.stringify(metafieldsSetInput, null, 2));
    
    // Use metafieldsSet mutation to set the metafields on the product
    const result = await graphqlRequest(
      `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
            ownerType
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        metafields: metafieldsSetInput,
      }
    );
    
    // Log the full GraphQL response for debugging
    console.log("GraphQL Response:", JSON.stringify(result, null, 2));
    
    if (result.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error("Error setting product metafields:", JSON.stringify(result.data.metafieldsSet.userErrors, null, 2));
      // Log but don't fail - webhook should still return 200
    } else {
      console.log("Successfully applied metafields to product");
      console.log(`Set ${result.data?.metafieldsSet?.metafields?.length || 0} metafields`);
    }
    
    // Check for GraphQL errors
    if (result.errors) {
      console.error("GraphQL Errors:", JSON.stringify(result.errors, null, 2));
    }
    
  } catch (error) {
    console.error("Error in products/create webhook:", error);
    // Return 200 anyway to prevent webhook retries
  }
  
  return new Response(null, { status: 200 });
};
