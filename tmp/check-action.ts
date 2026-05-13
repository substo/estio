import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { updateWhatsAppSettings } from "../app/(main)/admin/settings/integrations/whatsapp/actions";

// Mock auth
jest.mock("@clerk/nextjs/server", () => ({
    auth: () => ({ userId: "user_2test" })
}));

async function run() {
    const formData = new FormData();
    formData.append("locationId", "cmingx6b10008rdycg7hwesyn");
    formData.append("businessAccountId", "1240333231293494");
    formData.append("phoneNumberId", "1145391945320326");
    formData.append("accessToken", "EAAczyMojzxQBRczz7ZBv7EpDTdGp3NKKh3Q76ncpORLEtGko0IBszRyIBJI9yru5sJNCK1LxWDD4ahHUcOeWD0AgwhWYIm4BGhZAwoeIZBKt4ZC8xuZADo0Qbud4c2ZCEHm0l47K0lLtT2WnooEREKm2052qinXUckkILyZA2usgWcuZBFZBwAojE2RZCr5h8XBQZDZD");
    formData.append("clearWhatsAppAccessToken", "on"); // Because user checked it!
    
    try {
        const res = await updateWhatsAppSettings(formData);
        console.log("Action result:", res);
    } catch (e: any) {
        console.error("Action error:", e.message);
    }
}

run().catch(console.error);
