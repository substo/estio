import { z } from 'zod';

const email = "info=downtowncyprus.com@mg.downtowncyprus.com";
const schema = z.string().email();

try {
    schema.parse(email);
    console.log("Validation passed");
} catch (e: any) {
    console.log("Validation failed:", e.errors);
}
