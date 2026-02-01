import { z } from 'zod';

const email = "info=downtowncyprus.com@mg.downtowncyprus.com";
// Using the new regex
const schema = z.string().regex(/^[\w\-\.\+=]+@[\w\-\.]+\.[a-zA-Z]{2,}$/, 'Invalid email address');

try {
    schema.parse(email);
    console.log("Validation passed");
} catch (e: any) {
    console.log("Validation failed:", e.errors);
}
