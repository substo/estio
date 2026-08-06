import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const page = read('app/(main)/admin/user-profile/[[...user-profile]]/page.tsx');
const form = read('app/(main)/admin/user-profile/_components/user-profile-form.tsx');
const action = read('app/(main)/admin/profile-actions.ts');
const completeAction = action.slice(0, action.indexOf('export async function getUserProfileStatus'));
const legacyRoute = read('app/(main)/(auth)/user-profile/[[...user-profile]]/page.tsx');
const sessionLinks = read('app/(main)/admin/team/_components/access-sessions-section.tsx');

test('the canonical profile page renders one Estio personal-details section without embedded or retired profile applications', () => {
    assert.match(page, /<h1[^>]*>My profile<\/h1>/);
    assert.equal((page.match(/<h1\b/g) || []).length, 1);
    assert.match(page, /<UserProfileForm initialData=\{initialData\} primaryEmail=\{primaryEmail\} \/>/);
    assert.doesNotMatch(page, /AccountSecurityCard/);
    assert.equal(existsSync(path.join(root, 'app/(main)/admin/user-profile/_components/account-security-card.tsx')), false);
    assert.doesNotMatch(page, /<UserProfile\b/);
    assert.doesNotMatch(page, /WhatsAppVerification/);
    assert.equal(existsSync(path.join(root, 'app/(main)/admin/user-profile/_components/whatsapp-verification.tsx')), false);
    assert.equal(existsSync(path.join(root, 'app/(main)/admin/user-profile/verification-actions.ts')), false);
});

test('the self-profile form submits only local personal detail fields and announces save state', () => {
    const submittedNames = [...form.matchAll(/name="([^"]+)"/g)].map((match) => match[1]).sort();
    assert.deepEqual(submittedNames, ['firstName', 'lastName', 'timeZone']);
    assert.doesNotMatch(form, /name="(?:email|phone|userId)"/);
    assert.match(form, /<Label htmlFor="firstName">First name<\/Label>/);
    assert.match(form, /<Label htmlFor="lastName">Last name<\/Label>/);
    assert.match(form, /<Label htmlFor="timeZone">Time zone<\/Label>/);
    assert.match(form, /aria-live="polite"/);
    assert.match(form, /role=\{status\?\.type === 'error' \? 'alert' : 'status'\}/);
    assert.match(form, /<h2 id="personal-details-heading"/);
    assert.doesNotMatch(form, /CardTitle/);
});

test('the action authenticates and always targets the authenticated local user without requiring a location', () => {
    assert.match(completeAction, /const \{ userId: clerkUserId \} = await auth\(\)/);
    assert.match(completeAction, /if \(!clerkUserId\)[\s\S]*Unauthorized/);
    assert.match(completeAction, /where: \{ clerkId: clerkUserId \}/);
    assert.doesNotMatch(completeAction, /formData\.get\(['"](?:userId|email|phone)['"]\)/);
    assert.doesNotMatch(completeAction, /No active location/);
    assert.match(completeAction, /getLocationContext\(\)\.catch/);
    assert.match(completeAction, /activeLocation\?\.ghlLocationId/);
    assert.match(completeAction, /userId_locationId/);
    assert.match(completeAction, /updateGHLUser\([\s\S]*firstName,[\s\S]*lastName,/);
    assert.doesNotMatch(completeAction, /updateGHLUser\([\s\S]*?(?:phone|email):/);
});

test('account management opens as a modal with irrelevant API key navigation hidden', () => {
    assert.match(form, /id="account-security"/);
    assert.match(form, /Primary sign-in email/);
    assert.doesNotMatch(form, /Account security<\/h2>/);
    assert.match(form, /aria-label="Manage sign-in and security"/);
    assert.match(form, /openUserProfile\(\{ apiKeysProps: \{ hide: true \} \}\)/);
    assert.match(sessionLinks, /href="\/admin\/user-profile#account-security"/);
});

test('the duplicate profile route is an authenticated redirect to the canonical page', () => {
    assert.match(legacyRoute, /const \{ userId \} = await auth\(\)/);
    assert.match(legacyRoute, /if \(!userId\)[\s\S]*redirect\('\/sign-in'\)/);
    assert.match(legacyRoute, /redirect\('\/admin\/user-profile'\)/);
    assert.doesNotMatch(legacyRoute, /<UserProfile\b/);
});
