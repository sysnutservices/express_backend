/**
 * Node.js equivalent of:
 * merchantapi.accounts.products.list
 * using service account authentication
 */

import { google } from "googleapis";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// TODO: replace with your downloaded JSON service account key
const key = require("./gen-lang-client-0449047924-2f0c09256f96.json");

// TODO: replace with your Merchant ID
const merchantId = "5667870170";

// authenticate using service account
const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/content"]
});

// initialize content API client
const content = google.content("v2.1");

async function main() {
    try {
        // get access token (optional, just to confirm)
        const token = await auth.getAccessToken();
        console.log("ACCESS_TOKEN (debug):", token, "\n");

        // call products.list
        const res = await content.products.list({
            merchantId,
            auth
        });

        console.log("Products List Response:");
        console.dir(res.data, { depth: 10 });
    } catch (err) {
        console.error("\n❌ ERROR");
        console.error(err.response?.data || err.message);
    }
}

main();
