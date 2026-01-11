import { puppeteerService } from './puppeteer-service';
import { CRM_FIELD_MAPPING } from './field-mapping';
import db from '@/lib/db';
import path from 'path';
import fs from 'fs';
import https from 'https';
import os from 'os'; // Import os here
import { finished } from 'stream/promises';

export async function pushPropertyToCrm(propertyId: string, userId: string) {
    console.log(`[CRM PUSH] Starting for property ${propertyId} by user ${userId}`);

    // 1. Fetch Data
    const property = await db.property.findUnique({
        where: { id: propertyId },
        include: { media: true }
    });

    const user = await db.user.findUnique({
        where: { clerkId: userId },
    });

    if (!property) throw new Error("Property not found");
    if (!user) throw new Error("User not found");
    if (!user.crmUrl || !user.crmUsername || !user.crmPassword) {
        throw new Error("User is missing CRM credentials");
    }

    try {
        // Force init check
        await puppeteerService.init();

        // 2. Login
        await puppeteerService.login(user.crmUrl, user.crmUsername, user.crmPassword);

        // 3. Navigate to Create Page
        const page = await puppeteerService.getPage();

        // Try to find "Add Property" link
        const createUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            const addLink = links.find(a =>
                a.textContent?.toLowerCase().includes('add property') ||
                a.textContent?.toLowerCase().includes('new property') ||
                a.textContent?.toLowerCase().includes('create')
            );
            return addLink ? addLink.href : null;
        });

        if (createUrl) {
            console.log(`[CRM PUSH] Found Create URL: ${createUrl}`);
            await page.goto(createUrl, { waitUntil: 'domcontentloaded' });
        }

        // Enable console logging from browser to node terminal
        page.on('console', msg => {
            const text = msg.text();
            // Filter out some noise if needed, but for now we want everything related to our script
            if (text.includes('CRM PUSH')) console.log(`[BROWSER] ${text}`);
        });

        // 4. Fill Fields
        console.log(`[CRM PUSH] Filling fields...`);

        const fullProperty = await db.property.findUnique({
            where: { id: propertyId },
            include: {
                media: true,
                companyRoles: { include: { company: true } },
                contactRoles: { include: { contact: true } }
            }
        });

        if (!fullProperty) throw new Error("Property not found (refetch)");
        const flatData: any = { ...fullProperty };

        // Flatten Data logic
        const owner = fullProperty.contactRoles.find(r => r.role === 'Owner')?.contact;
        if (owner) {
            flatData.ownerName = owner.name;
            flatData.ownerEmail = owner.email;
            flatData.ownerPhone = owner.phone;
        }

        let currentTab = '';

        for (const map of CRM_FIELD_MAPPING) {
            // Skip '#tab_publish' - REMOVED to allow setting Active status
            // if (map.tab && map.tab === '#tab_publish') {
            //     console.log(`[CRM PUSH] Skipping '#tab_publish' to prevent auto-publishing as requested.`);
            //     continue;
            // }

            // Tab Switching
            if (map.tab && map.tab !== currentTab) {
                try {
                    console.log(`[CRM PUSH] Switching to tab ${map.tab}...`);
                    await page.click(map.tab);
                    await new Promise(r => setTimeout(r, 500));
                    currentTab = map.tab;
                } catch (e) {
                    console.warn(`[CRM PUSH] Failed to switch tab ${map.tab}`);
                }
            }

            // Checkbox Groups (Features)
            if (map.type === 'checkbox-group') {
                const features = flatData.features as string[] || [];
                if (features.length === 0) continue;
                await page.evaluate((featuresToSelect) => {
                    const labels = Array.from(document.querySelectorAll('label'));
                    featuresToSelect.forEach(featureText => {
                        const targetLabel = labels.find(l =>
                            l.textContent?.toLowerCase().trim() === featureText.toLowerCase().trim() ||
                            l.textContent?.toLowerCase().includes(featureText.toLowerCase())
                        );
                        if (targetLabel) {
                            // Logic to find input inside or near label
                            let input = targetLabel.querySelector('input') ||
                                document.getElementById(targetLabel.htmlFor) as HTMLInputElement ||
                                targetLabel.previousElementSibling as HTMLInputElement;

                            if (input && input.type === 'checkbox' && !input.checked) input.click();
                        }
                    });
                }, features);
                continue;
            }

            // Normal Fields
            let value = flatData[map.dbField];
            let finalValue = map.transform ? map.transform(value, fullProperty) : value;

            console.log(`[CRM PUSH] Field: ${map.dbField} -> Raw: "${value}" -> Transformed: "${finalValue}"`);

            if (finalValue === undefined || finalValue === null || finalValue === '') {
                console.log(`[CRM PUSH] Skipping ${map.dbField} because finalValue is empty.`);
                continue;
            }
            finalValue = finalValue.toString();

            try {
                // Owner Special Logic
                if (map.dbField.startsWith('owner') && map.dbField !== 'owner_id' && flatData.ownerName) {
                    await page.evaluate(() => {
                        const sel = document.querySelector('#owner_id') as HTMLSelectElement;
                        if (sel && sel.value !== 'add') {
                            sel.value = 'add';
                            sel.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    });
                }

                // TinyMCE
                if (map.dbField === 'description') {
                    await page.evaluate((content) => {
                        const tmce = (window as any).tinyMCE;
                        if (tmce && tmce.activeEditor) tmce.activeEditor.setContent(content);
                    }, finalValue);
                    continue;
                }

                // Standard Inputs
                const element = await page.$(map.selector);
                if (element) {
                    if (map.type === 'select') {
                        await page.evaluate((sel, val) => {
                            const select = document.querySelector(sel) as HTMLSelectElement;
                            if (select) {
                                const candidates = val.split('|||');
                                let matchFound = false;
                                const options = Array.from(select.options);

                                console.log(`[CRM PUSH] Select ${sel} - Candidates: ${JSON.stringify(candidates)}`);
                                console.log(`[CRM PUSH] Select ${sel} - Total options: ${options.length}`);

                                for (const candidate of candidates) {
                                    if (matchFound) break; // Stop if we found a match for a previous candidate

                                    const currentVal = candidate.trim();
                                    console.log(`[CRM PUSH] Trying candidate: "${currentVal}"`);

                                    // 1. Try Exact Value Match
                                    if (options.some(o => o.value === currentVal)) {
                                        console.log(`[CRM PUSH] Found exact value match: ${currentVal}`);
                                        select.value = currentVal;
                                        matchFound = true;
                                    } else {
                                        // 2. Try Text Match (Fuzzy)
                                        const cleanVal = currentVal.toLowerCase();

                                        const textOption = options.find(o => {
                                            const optText = o.text.toLowerCase().trim();
                                            return optText === cleanVal ||
                                                optText.includes(cleanVal) ||
                                                cleanVal.includes(optText);
                                        });

                                        if (textOption) {
                                            console.log(`[CRM PUSH] Found fuzzy match! Input: "${currentVal}" -> Matched Option: "${textOption.text}" (Value: ${textOption.value})`);
                                            select.value = textOption.value;
                                            matchFound = true;
                                        } else {
                                            console.warn(`[CRM PUSH] NO MATCH found for "${currentVal}"`);
                                        }
                                    }
                                }

                                if (matchFound) {
                                    select.dispatchEvent(new Event('change', { bubbles: true }));
                                    const $ = (window as any).jQuery;
                                    if ($ && $(sel).length) {
                                        $(sel).trigger("chosen:updated").trigger("change");
                                    }
                                } else {
                                    console.error(`[CRM PUSH] Failed to match ANY candidates for ${sel}`);
                                }
                            } else {
                                console.warn(`[CRM PUSH] Select element not found for selector: ${sel}`);
                            }
                        }, map.selector, finalValue);
                    } else {
                        await page.evaluate((sel, val) => {
                            const el = document.querySelector(sel) as HTMLInputElement;
                            if (el) el.value = val;
                        }, map.selector, finalValue);
                    }
                }
            } catch (e) {
                console.error(`[CRM PUSH] Error filling ${map.dbField}`, e);
            }
        }

        // 5. Image Upload
        const images = property.media.filter(m => m.kind === 'IMAGE');

        if (images.length > 0) {
            console.log(`[CRM PUSH] Processing ${images.length} images...`);

            // Create Unique Temp Dir
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx_crm_'));

            try {
                // Switch to Images Tab explicitly
                try {
                    await page.click('a[href="#tab_images"]');
                    await new Promise(r => setTimeout(r, 1000));
                } catch (e) { console.warn("Could not find/click images tab"); }

                const filePaths: string[] = [];

                // Download Loop
                for (const img of images) {
                    const ext = '.jpg';
                    const safeId = property.id.replace(/[^a-z0-9]/gi, '_');
                    const filename = `prop_${safeId}_${img.id}${ext}`;
                    const filePath = path.join(tempDir, filename);

                    try {
                        await downloadFile(img.url, filePath);
                        filePaths.push(filePath);
                    } catch (e: any) {
                        console.error(`[CRM PUSH] Failed to download ${img.url}:`, e.message);
                    }
                }

                console.log(`[CRM PUSH] Attempting to upload ${filePaths.length} files...`);

                if (filePaths.length > 0) {
                    console.log(`[CRM PUSH] Starting FileChooser interception...`);
                    try {
                        // Start waiting for the file chooser BEFORE clicking
                        // Increased timeout to 15s
                        const fileChooserPromise = page.waitForFileChooser({ timeout: 15000 });

                        // Click the dropzone / select button
                        let foundDropzone = await page.evaluate(() => {
                            // Try clicking the inner message area first, as it often has the text
                            const messageArea = document.querySelector('.dz-message') as HTMLElement;
                            if (messageArea) {
                                messageArea.click();
                                return true;
                            }

                            // Specific ID from user HTML
                            const mainDropzone = document.getElementById('mydropzone');
                            if (mainDropzone) {
                                mainDropzone.click();
                                return true;
                            }
                            return false;
                        });

                        if (!foundDropzone) {
                            console.warn("[CRM PUSH] Could not find '#mydropzone' or '.dz-message'. Attempting fuzzy match.");
                            foundDropzone = await page.evaluate(() => {
                                const all = Array.from(document.querySelectorAll('div, a, span'));
                                const target = all.find(el => el.textContent?.toLowerCase().includes('drop your images here'));
                                if (target) {
                                    (target as HTMLElement).click();
                                    return true;
                                }
                                return false;
                            });
                        }

                        if (!foundDropzone) {
                            console.warn("[CRM PUSH] Could not find 'Drop / Select Images' area by text. Attempting fallback to finding file input label.");
                            // Fallback: Try to click the label for file input
                            await page.evaluate(() => {
                                const fileInput = document.querySelector('input[type="file"]');
                                if (fileInput) {
                                    const id = fileInput.id;
                                    if (id) {
                                        const label = document.querySelector(`label[for="${id}"]`);
                                        if (label) (label as HTMLElement).click();
                                    } else {
                                        const parentLabel = fileInput.closest('label');
                                        if (parentLabel) parentLabel.click();
                                    }
                                }
                            });
                        }

                        // Await the chooser
                        const fileChooser = await fileChooserPromise;
                        if (fileChooser) {
                            console.log(`[CRM PUSH] FileChooser intercepted. Uploading ${filePaths.length} files...`);
                            await fileChooser.accept(filePaths);

                            // Poll for upload status with logging for better visibility
                            console.log("[CRM PUSH] Monitoring upload progress...");
                            const startTime = Date.now();
                            const TIMEOUT = 120000; // 2 minutes
                            let maxFilesSeen = 0;

                            while (true) {
                                const status = await page.evaluate(() => {
                                    const total = document.querySelectorAll('.dz-preview').length;
                                    const complete = document.querySelectorAll('.dz-preview.dz-complete').length;
                                    const success = document.querySelectorAll('.dz-preview.dz-success').length;
                                    const error = document.querySelectorAll('.dz-preview.dz-error').length;
                                    const processing = document.querySelectorAll('.dz-preview.dz-processing').length;

                                    // Sometimes complete/success checks are overlapping or distinct depending on theme
                                    // Robust check: finished if (complete OR success OR error) count matches total
                                    // AND processing is 0.

                                    // We need to be careful not to double count if an element has both 'dz-complete' and 'dz-success'
                                    // So let's count based on elements
                                    const allPreviews = Array.from(document.querySelectorAll('.dz-preview'));
                                    const finishedCount = allPreviews.filter(el =>
                                        el.classList.contains('dz-complete') ||
                                        el.classList.contains('dz-success') ||
                                        el.classList.contains('dz-error')
                                    ).length;

                                    return { total, finishedCount, processing };
                                });

                                maxFilesSeen = Math.max(maxFilesSeen, status.total);

                                const elapsed = Date.now() - startTime;
                                console.log(`[CRM PUSH] Upload Status (${Math.round(elapsed / 1000)}s): Found ${status.total}, Finished ${status.finishedCount}, Processing ${status.processing}`);

                                // 1. Standard Success: All files visible and marked complete
                                if (status.total > 0 && status.finishedCount >= status.total && status.processing === 0) {
                                    console.log("[CRM PUSH] All uploads active and marked finished.");
                                    break;
                                }

                                // 2. Auto-Clear Success: We saw files before, but now they are gone (0 total).
                                // This happens if the CRM clears the dropzone after a successful batch.
                                if (maxFilesSeen > 0 && status.total === 0) {
                                    console.log("[CRM PUSH] Previews disappeared (auto-clear detected). Assuming upload complete.");
                                    break;
                                }

                                if (elapsed > TIMEOUT) {
                                    throw new Error(`Upload timed out after ${TIMEOUT}ms. Last status: Total ${status.total}, Finished ${status.finishedCount}`);
                                }

                                await new Promise(r => setTimeout(r, 2000));
                            }

                            // Small buffer for animations/cleanup
                            await new Promise(r => setTimeout(r, 1000));
                        } else {
                            throw new Error("File chooser did not appear after click.");
                        }

                    } catch (err: any) {
                        console.error(`[CRM PUSH] Upload simulation failed:`, err.message);
                        throw new Error(`Image upload failed: ${err.message}`);
                    }
                }
            } finally {
                // Cleanup
                try {
                    if (fs.existsSync(tempDir)) {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                        console.log(`[CRM PUSH] Cleaned up temp dir: ${tempDir}`);
                    }
                } catch (cleanupErr) {
                    console.error("[CRM PUSH] Failed to cleanup temp dir:", cleanupErr);
                }
            }
        }

        // 6. Save Form
        console.log(`[CRM PUSH] Saving form...`);
        try {
            // Check for validation errors before submitting
            const validationErrors = await page.evaluate(() => {
                const errors = Array.from(document.querySelectorAll('.has-error, .text-danger, .alert-danger'));
                return errors.map(e => e.textContent?.trim()).filter(Boolean);
            });

            if (validationErrors.length > 0) {
                console.warn(`[CRM PUSH] Possible validation errors detected before save:`, validationErrors);
            }

            // Attempt Click with Puppeteer (Reliable for visibility)
            let clickSuccess = false;
            try {
                const submitBtn = await page.$('#submitButton');
                if (submitBtn) {
                    console.log("[CRM PUSH] Found #submitButton, clicking via Puppeteer...");
                    // We don't await navigation here yet, we race it below
                    await submitBtn.click();
                    clickSuccess = true;
                } else {
                    console.warn("[CRM PUSH] #submitButton not found via selector.");
                }
            } catch (e) {
                console.warn("[CRM PUSH] Puppeteer click failed, trying JS evaluation.", e);
            }

            // Fallback: Direct JS Submit if click didn't work or we want to double down
            if (!clickSuccess) {
                console.log("[CRM PUSH] Attempting direct JS submit...");
                await page.evaluate(() => {
                    // Try the onclick handler logic explicitly
                    const $ = (window as any).jQuery;
                    if ($) {
                        $('#form').submit();
                    } else {
                        const form = document.getElementById('form') as HTMLFormElement;
                        if (form) form.submit();
                    }
                });
            }

            // Wait for navigation or success message
            console.log("[CRM PUSH] Waiting for navigation...");
            try {
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
                console.log(`[CRM PUSH] Navigation completed. Save successful.`);
            } catch (navErr: any) {
                console.warn("[CRM PUSH] Navigation timed out. Checking for success indicators or errors.");
                // Check URL or Body for success
                const result = await page.evaluate(() => {
                    return {
                        url: window.location.href,
                        body: document.body.innerText.toLowerCase()
                    };
                });

                if (result.url.includes('properties') && !result.url.includes('create')) {
                    console.log("[CRM PUSH] User redirected to list. Success likely.");
                } else if (result.body.includes('saved') || result.body.includes('success')) {
                    console.log("[CRM PUSH] Success text found on page.");
                } else {
                    console.error("[CRM PUSH] No navigation and no success message found. Validation might have failed.");
                    // Dump errors again
                    const errors = await page.evaluate(() => {
                        const errs = Array.from(document.querySelectorAll('.has-error, .text-danger'));
                        return errs.map(e => e.textContent?.trim()).filter(Boolean);
                    });
                    if (errors.length > 0) {
                        throw new Error(`CRM Validation Errors: ${errors.join(', ')}`);
                    }
                }
            }

        } catch (e: any) {
            console.error(`[CRM PUSH] Error during save/submit:`, e.message);
            // Throw so the user sees the error
            throw e;
        }

        return { success: true, message: "Property pushed. Please check CRM for confirmation." };

    } catch (e: any) {
        console.error("CRM Push Failed:", e);
        return { success: false, error: e.message };
    }
}

async function downloadFile(url: string, outputPath: string) {
    const file = fs.createWriteStream(outputPath);
    return new Promise<void>((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Status ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            finished(file).then(() => resolve()).catch(reject);
        }).on('error', reject);
    });
}