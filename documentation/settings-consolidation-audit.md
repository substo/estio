# CRM and Studio settings audit

Compared the tree before `cb5cc77c` with `502a6853`. The earlier `4408b7b7` commit establishes Substo’s CRM access rules. This is a Git and route-policy audit. It does not establish which providers are configured or which credentials exist for a particular Location.

## Page inventory

| Former entry | Current entry | Availability and outcome |
| --- | --- | --- |
| `/admin/settings` | `/settings` | Shared overview. `cb5cc77c` changed Substo’s menu from disabled cards for unsupported sections to a list of available settings. |
| `/admin/settings/integrations` | `/settings/integrations` | Moved. Substo’s previous page showed a disabled **Setup pending** card. The destination was already outside its allowlist under `4408b7b7`. The new menu omits it. |
| Integrations children `google`, `microsoft`, `sms-relay`, `provider-sync`, `ghl`, `old-crm`, `gemini`, `openai-api`, `chatgpt-subscription`, `whatsapp`, `whatsapp/linked-phone`, `whatsapp/meta`, `whatsapp/twilio` | Same suffixes under `/settings/integrations/` | All 13 page files moved. Estio retains the landing page and the existing authorization for each integration. Substo’s AI page has its own supported key controls. An existing page file does not prove that a provider is enabled or configured. |
| `/admin/settings/crm` and `/admin/settings/integrations/openai` | `/settings/integrations/old-crm` and `/settings/integrations/chatgpt-subscription` | Removed aliases. Both original pages only redirected. Lead source management remains inside Old CRM. |
| `/admin/settings/prospecting` | `/settings/prospecting` | Moved with six subpages covering connector creation and editing, credential creation and editing, and task creation and editing. Substo previously showed it as Setup pending. |
| `/admin/settings/location-data` and `/admin/settings/media` | `/settings/location-data` and `/settings/media` | Moved. The pages required Estio admin authority before the move. The shared sidebar also checks the role. Substo’s previous cards were disabled. |
| `/admin/settings/notifications` | `/settings/notifications` | Moved. Still available in both apps. Browser push subscription is a notification feature, independent of in-app confirmation dialogs. |
| `/admin/team` and `/brand/team` | `/settings/team` | Moved into shared Settings. Estio admin access and Substo’s team permissions remain app-specific. |
| `/brand/settings` and the Business profile card | `/settings/general` | Substo’s rename form moved to General. General links to the existing business-profile flow in the relevant app. |
| `/admin/site-settings` and `/admin/site-settings/navigation` | CRM → Website → Appearance and Menus | First moved under `/settings/website` in `cb5cc77c`, then to `/admin/content/website/appearance` and `/admin/content/website/navigation` in `502a6853`. Estio’s domain management and Substo’s public address/publish controls are under Publishing. Substo Menus now explicitly requires admin; its save actions already required admin. |
| CRM and Studio AI | `/settings/ai` and the feature settings listed below | The shared page replaced the provider summary and global text model controls with ordered provider fallback, per-task choices, connection state and paid usage. |
| Studio Connected computer | Settings → Devices | Existing `/settings/computer` pairing URL remains in the Mac companion protocol. Devices separates Computers from Mobile, using Estio’s existing SIM Relay inventory for Android and approval-based iPhone SMS. |
| Studio and profile-menu My connections | Settings → Account → My connections | The page and Google OAuth routes stayed at `/account/connections`. This change puts that account-owned page in the shared Settings shell. Both CRM and Studio can reach it without moving OAuth callbacks or coupling credential ownership to a Location. |

## Controls that need attention

- **Substo integration discoverability.** The loss in `cb5cc77c` was the Setup pending entry. Google Workspace, Outlook, WhatsApp, SIM Relay, and legacy CRM setup were already blocked on Substo. Opening any of those to Substo is a separate product and authorization change. Google/YouTube profile OAuth uses separate account authorization.
- **Location-wide AI presets.** Balanced, Lowest cost, Best quality and Custom radio presets were removed in `cb5cc77c`. Per-task model selection and fallback ordering are available, but there is no equivalent one-click bundle.
- **Old model fields.** The general, draft and translation Gemini selectors were removed from the old form. The new routing screen exposes task families, and Property media still exposes import and design models. Legacy values are still read in compatibility and fixed-path code, including legacy property translation. Review each reader before claiming that the per-task controls cover every old selector.
- **Standalone brand voice generation.** The old AI form included a website URL field and a Generate with AI button that filled the Brand Voice textarea. General and Studio’s Brand profile still provide business profile editing and research flows. The old inline interaction was removed. The same generation action remains in onboarding.
- **Contacts and runtime controls.** Conversations retains reply language, transcript controls and Skill Runtime. Contacts retains intelligence controls, outreach and the contact verification/queue actions. Live Assist retains its policy and models. Property media retains precision remove, import and design. The old Automation Hub component was removed in `cb5cc77c` after it had already been disconnected from the settings UI by `3fec40a9`. Its absence therefore predates the shared settings merge.
- **Personal social providers.** The Settings menu omitted the existing profile page in `cb5cc77c`. The YouTube authorization remains read-only for discovery. Additional providers appear as planned in the account page, with no authorization or automation implied.

## How to catch this in a merge

Start with `git ls-tree` for both parent trees and `git diff --name-status -M` for the candidate. List every affected page file and user-facing control. Record its old URL and entry point, new destination, realm and role, linked actions and callbacks, and whether it moved, was replaced, or was deliberately retired. Review unexplained deletions before accepting the merge.

Verify the merged candidate through the menus and direct routes as Estio and Substo admins and members. Add signed-in no-Location and tenant-host cases when relevant. Check actual controls and their authorization, deep links and action outcomes. A route file can survive while a menu link, permission, or field is lost.
