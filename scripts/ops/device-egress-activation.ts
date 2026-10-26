// Prints the Android device egress state for deploy-local-build.sh:
// "enabled", or "disabled:<reason>" when no canary/production scope is active.
// Invalid configuration prints only its non-secret code and exits 1.
import {
    WhatsAppDeviceEgressConfigurationError,
    validateWhatsAppDeviceEgressStartupConfiguration,
} from "../../lib/device-tunnel/startup-configuration";

try {
    const { disabledReason } = validateWhatsAppDeviceEgressStartupConfiguration();
    console.log(disabledReason ? `disabled:${disabledReason}` : "enabled");
} catch (error) {
    console.log(`invalid:${error instanceof WhatsAppDeviceEgressConfigurationError ? error.code : "startup_configuration_invalid"}`);
    process.exitCode = 1;
}
