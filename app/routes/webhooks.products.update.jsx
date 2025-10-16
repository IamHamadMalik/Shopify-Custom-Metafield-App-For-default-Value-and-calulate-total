import { authenticate, sessionStorage } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Get the product ID from the webhook payload
    const productId = payload.id;
    const productGid = `gid://shopify/Product/${productId}`;
    
    console.log(`Processing product update: ${productGid}`);
    
    // Load offline session to get access token
    const session = await sessionStorage.loadSession(`offline_${shop}`);
    
    if (!session) {
      console.error("No session found for shop:", shop);
      return new Response(null, { status: 200 });
    }
    
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
    
    // Fetch the product metafields to get material_costs and hours_worked
    const productData = await graphqlRequest(
      `query getProductMetafields($id: ID!) {
        product(id: $id) {
          id
          metafields(first: 20, namespace: "custom") {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
      }`,
      {
        id: productGid,
      }
    );
    const metafields = productData.data?.product?.metafields?.edges || [];
    
    // Extract material_costs, hours_worked, and rarity from the product
    const materialCostsField = metafields.find(edge => edge.node.key === "material_costs");
    const hoursWorkedField = metafields.find(edge => edge.node.key === "hours_worked");
    const rarityField = metafields.find(edge => edge.node.key === "rarity");
    
    const materialCosts = materialCostsField ? parseFloat(materialCostsField.node.value) : null;
    const hoursWorked = hoursWorkedField ? parseFloat(hoursWorkedField.node.value) : null;
    const productRarity = rarityField?.node.value || "NORMAL"; // Read from product, default to NORMAL
    
    // Both material_costs and hours_worked must exist
    if (materialCosts === null || hoursWorked === null) {
      console.log("Skipping calculation: material_costs or hours_worked is missing");
      return new Response(null, { status: 200 });
    }
    
    console.log(`Material Costs: €${materialCosts}, Hours Worked: ${hoursWorked}`);
    
    // Fetch the default values from database
    const defaults = await prisma.metafieldDefaults.findUnique({
      where: { shop },
    });
    
    if (!defaults) {
      console.log("No default metafield values found for this shop");
      return new Response(null, { status: 200 });
    }
    
    // Parse defaults (use 0 if not set)
    const hourlyRate = defaults.hourlyRate ? parseFloat(defaults.hourlyRate) : 0;
    const markup = defaults.etsyMarkupProfit ? parseFloat(defaults.etsyMarkupProfit) : 0;
    const vat = defaults.vat ? parseFloat(defaults.vat) : 0;
    const shipping = defaults.shipping ? parseFloat(defaults.shipping) : 0;
    const discount = defaults.etsyDiscount ? parseFloat(defaults.etsyDiscount) : 0;
    const normalMultiplier = defaults.normalMultiplier ? parseFloat(defaults.normalMultiplier) : 1.2;
    const ooakMultiplier = defaults.ooakMultiplier ? parseFloat(defaults.ooakMultiplier) : 2;
    
    // Determine rarity multiplier based on THIS PRODUCT's rarity metafield
    const rarityMultiplier = productRarity.toUpperCase() === "OOAK" ? ooakMultiplier : normalMultiplier;
    
    console.log(`Using defaults: Rate=€${hourlyRate}, Markup=${markup}%, VAT=${vat}%, Shipping=€${shipping}, Discount=${discount}%`);
    console.log(`Product-specific: Rarity=${productRarity}, Multiplier=${rarityMultiplier}`);
    
    // ===== CALCULATIONS =====
    
    // 1. Calculate Total Cost
    const labor = hoursWorked * hourlyRate;
    const totalCost = materialCosts + labor;
    
    // 2. Calculate Etsy Price
    const base = (materialCosts + labor) * (1 + markup / 100);
    const rarityAdjusted = base * rarityMultiplier;
    const subtotal = rarityAdjusted + shipping;
    const priceWithVat = subtotal * (1 + vat / 100);
    const etsyFeesAmount = (priceWithVat * 0.095) + 0.20;
    let finalEtsyPrice = priceWithVat + etsyFeesAmount;
    
    // Adjust for Etsy discount
    if (discount > 0) {
      finalEtsyPrice = finalEtsyPrice / (1 - discount / 100);
    }
    
    // 3. Etsy Fees (already calculated above)
    const etsyFees = etsyFeesAmount;
    
    // 4. Calculate Market Price
    const marketBase = (materialCosts + labor) * 1.05;
    const marketPrice = marketBase * rarityMultiplier;
    
    console.log(`Calculated: Total Cost=€${totalCost.toFixed(2)}, Etsy Price=€${finalEtsyPrice.toFixed(2)}, Etsy Fees=€${etsyFees.toFixed(2)}, Market Price=€${marketPrice.toFixed(2)}`);
    
    // ===== UPDATE METAFIELDS =====
    
    const metafieldsToSet = [
      {
        ownerId: productGid,
        namespace: "custom",
        key: "total_cost",
        value: totalCost.toFixed(2),
        type: "number_decimal"
      },
      {
        ownerId: productGid,
        namespace: "custom",
        key: "etsy_price",
        value: finalEtsyPrice.toFixed(2),
        type: "number_decimal"
      },
      {
        ownerId: productGid,
        namespace: "custom",
        key: "etsy_fees",
        value: etsyFees.toFixed(2),
        type: "number_decimal"
      },
      {
        ownerId: productGid,
        namespace: "custom",
        key: "market_price",
        value: marketPrice.toFixed(2),
        type: "number_decimal"
      }
    ];
    
    // Use metafieldsSet mutation to update the calculated fields
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
        metafields: metafieldsToSet,
      }
    );
    
    if (result?.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error("Error setting calculated metafields:", result.data.metafieldsSet.userErrors);
    } else {
      console.log("Successfully calculated and updated metafields");
      console.log(`Updated ${result?.data?.metafieldsSet?.metafields?.length || 0} metafields`);
    }
    
  } catch (error) {
    console.error("Error in products/update webhook:", error);
    // Return 200 anyway to prevent webhook retries
  }
  
  return new Response(null, { status: 200 });
};

