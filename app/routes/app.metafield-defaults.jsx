import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  // Get existing defaults for this shop
  const defaults = await prisma.metafieldDefaults.findUnique({
    where: { shop: session.shop },
  });
  
  return { defaults: defaults || null };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const data = {
    shop: session.shop,
    etsyDiscount: formData.get("etsyDiscount") || null,
    shipping: formData.get("shipping") || null,
    vat: formData.get("vat") || null,
    normalMultiplier: formData.get("normalMultiplier") || null,
    ooakMultiplier: formData.get("ooakMultiplier") || null,
    etsyMarkupProfit: formData.get("etsyMarkupProfit") || null,
    hourlyRate: formData.get("hourlyRate") || null,
    rarity: formData.get("rarity") || null,
  };
  
  // Upsert the defaults (create or update)
  const result = await prisma.metafieldDefaults.upsert({
    where: { shop: session.shop },
    update: data,
    create: data,
  });
  
  return { success: true, defaults: result };
};

export default function MetafieldDefaults() {
  const { defaults } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  
  // Form state
  const [formData, setFormData] = useState({
    etsyDiscount: defaults?.etsyDiscount || "",
    shipping: defaults?.shipping || "",
    vat: defaults?.vat || "",
    normalMultiplier: defaults?.normalMultiplier || "",
    ooakMultiplier: defaults?.ooakMultiplier || "",
    etsyMarkupProfit: defaults?.etsyMarkupProfit || "",
    hourlyRate: defaults?.hourlyRate || "",
    rarity: defaults?.rarity || "",
  });
  
  const isLoading = fetcher.state === "submitting";
  
  // Show success toast when saved
  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Metafield defaults saved successfully");
    }
  }, [fetcher.data?.success, shopify]);
  
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };
  
  const handleSubmit = (e) => {
    e.preventDefault();
    const submitFormData = new FormData();
    Object.keys(formData).forEach(key => {
      if (formData[key]) {
        submitFormData.append(key, formData[key]);
      }
    });
    fetcher.submit(submitFormData, { method: "POST" });
  };
  
  return (
    <s-page heading="Metafield Defaults">
      <s-section>
        <s-paragraph>
          Set default values for product metafields. These values will be automatically 
          applied to all new products when they are created.
        </s-paragraph>
      </s-section>
      
      <s-section heading="Default Values">
        <form onSubmit={handleSubmit}>
          <s-stack direction="block" gap="large">
            {/* Etsy Discount (%) */}
            <s-text-field
              label="Etsy Discount (%)"
              type="number"
              step="0.01"
              value={formData.etsyDiscount}
              onInput={(e) => handleChange("etsyDiscount", e.target.value)}
              helpText="Percentage discount applied on Etsy"
            />
            
            {/* Shipping (€) */}
            <s-text-field
              label="Shipping (€)"
              type="number"
              step="0.01"
              value={formData.shipping}
              onInput={(e) => handleChange("shipping", e.target.value)}
              helpText="Shipping cost in Euros"
            />
            
            {/* VAT (%) */}
            <s-text-field
              label="VAT (%)"
              type="number"
              step="0.01"
              value={formData.vat}
              onInput={(e) => handleChange("vat", e.target.value)}
              helpText="Value-added tax percentage"
            />
            
            {/* Normal Multiplier */}
            <s-text-field
              label="Normal Multiplier"
              type="number"
              step="0.01"
              value={formData.normalMultiplier}
              onInput={(e) => handleChange("normalMultiplier", e.target.value)}
              helpText="Multiplier for normal products"
            />
            
            {/* OOAK Multiplier */}
            <s-text-field
              label="OOAK Multiplier"
              type="number"
              step="0.01"
              value={formData.ooakMultiplier}
              onInput={(e) => handleChange("ooakMultiplier", e.target.value)}
              helpText="Multiplier for one-of-a-kind products (multiplies by 2)"
            />
            
            {/* Rarity - Default for new products */}
            <s-text-field
              label="Default Rarity"
              type="text"
              value={formData.rarity}
              onInput={(e) => handleChange("rarity", e.target.value)}
              helpText="Default rarity for new products (OOAK or NORMAL)"
            />
            
            {/* Etsy Markup / Profit (%) */}
            <s-text-field
              label="Etsy Markup / Profit (%)"
              type="number"
              step="0.01"
              value={formData.etsyMarkupProfit}
              onInput={(e) => handleChange("etsyMarkupProfit", e.target.value)}
              helpText="Markup or profit percentage for Etsy"
            />
            
            {/* Hourly Rate (€) */}
            <s-text-field
              label="Hourly Rate (€)"
              type="number"
              step="0.01"
              value={formData.hourlyRate}
              onInput={(e) => handleChange("hourlyRate", e.target.value)}
              helpText="Hourly rate in Euros"
            />
            
            <s-button
              type="submit"
              variant="primary"
              {...(isLoading ? { loading: true } : {})}
            >
              Save Defaults
            </s-button>
          </s-stack>
        </form>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

