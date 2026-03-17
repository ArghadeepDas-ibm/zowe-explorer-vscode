/**
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

import { WebView, FileManagement } from "@zowe/zowe-explorer-api";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { ZoweLogger } from "../tools/ZoweLogger";
import { Profiles } from "../configuration/Profiles";

interface ConfigData {
    profiles?: Record<string, any>;
    defaults?: Record<string, any>;
    autoStore?: boolean;
    [key: string]: any;
}

interface UpdateConfigMessage {
    section: string;
    rowData: any;
    field: string;
    oldValue: any;
    newValue: any;
}

export class ConfigEditor extends WebView {
    private configPath: string | null = null;
    private configData: ConfigData | null = null;
    public static instance: ConfigEditor | undefined;

    public static async display(context: vscode.ExtensionContext): Promise<void> {
        // Try to find config file using the same logic as Zowe Explorer
        const configPath = await ConfigEditor.findConfigFile();

        if (!configPath) {
            const createConfig = vscode.l10n.t("Create Config");
            const openFolder = vscode.l10n.t("Open Folder");
            const result = await vscode.window.showErrorMessage(
                vscode.l10n.t("No zowe.config.json found. Checked workspace and ~/.zowe directory."),
                createConfig,
                openFolder
            );

            if (result === createConfig) {
                // Trigger the create config command if it exists
                await vscode.commands.executeCommand("zowe.all.config.init");
            } else if (result === openFolder) {
                await vscode.commands.executeCommand("vscode.openFolder");
            }
            return;
        }

        // Open the editor
        if (ConfigEditor.instance) {
            ConfigEditor.instance.panel?.reveal();
        } else {
            ConfigEditor.instance = new ConfigEditor(context);
            ConfigEditor.instance.panel?.onDidDispose(() => {
                ConfigEditor.instance = undefined;
            });
        }
    }

    /**
     * Find config file using the same logic as Zowe Explorer:
     * 1. Check workspace for zowe.config.user.json
     * 2. Check workspace for zowe.config.json
     * 3. Check ~/.zowe for zowe.config.user.json
     * 4. Check ~/.zowe for zowe.config.json
     */
    private static async findConfigFile(): Promise<string | null> {
        const locations: string[] = [];

        // Check workspace first
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const rootPath = workspaceFolders[0].uri.fsPath;
            locations.push(path.join(rootPath, "zowe.config.user.json"), path.join(rootPath, "zowe.config.json"));
        }

        // Check ~/.zowe directory
        const zoweDir = FileManagement.getZoweDir();
        locations.push(path.join(zoweDir, "zowe.config.user.json"), path.join(zoweDir, "zowe.config.json"));

        // Return first existing file
        for (const location of locations) {
            try {
                await fs.access(location);
                ZoweLogger.info(`[ConfigEditor] Found config at: ${location}`);
                return location;
            } catch {
                // File doesn't exist, continue
            }
        }

        return null;
    }

    public constructor(context: vscode.ExtensionContext) {
        super(vscode.l10n.t("Zowe Config Editor"), "config-editor", context, {
            onDidReceiveMessage: (message: object) => this.onDidReceiveMessage(message),
            retainContext: true,
            viewColumn: vscode.ViewColumn.Active,
        });
    }

    protected async onDidReceiveMessage(message: any): Promise<void> {
        try {
            switch (message.command) {
                case "ready":
                    await this.loadConfigData();
                    break;
                case "get-config-data":
                    await this.sendConfigData(message.requestId);
                    break;
                case "get-profile-status":
                    await this.sendProfileStatus(message.requestId);
                    break;
                case "get-profile-schemas":
                    await this.sendProfileSchemas(message.requestId);
                    break;
                case "update-config-data":
                    await this.updateConfigData(message.payload, message.requestId);
                    break;
                case "add-config-row":
                    await this.addConfigRow(message.payload, message.requestId);
                    break;
                case "delete-config-row":
                    await this.deleteConfigRow(message.payload, message.requestId);
                    break;
                case "GET_LOCALIZATION":
                    await this.sendLocalization();
                    break;
                default:
                    ZoweLogger.warn(`[ConfigEditor] Unknown command: ${String(message.command)}`);
                    break;
            }
        } catch (error) {
            ZoweLogger.error(`[ConfigEditor] Error handling message: ${String(error)}`);
            if (message.requestId) {
                await this.panel.webview.postMessage({
                    requestId: message.requestId,
                    error: String(error),
                });
            }
        }
    }

    private async sendLocalization(): Promise<void> {
        const l10nUri = vscode.l10n.uri;
        if (l10nUri) {
            try {
                const l10nContents = await fs.readFile(l10nUri.fsPath, { encoding: "utf8" });
                await this.panel.webview.postMessage({
                    command: "GET_LOCALIZATION",
                    requestId: "GET_LOCALIZATION",
                    payload: JSON.parse(l10nContents),
                });
            } catch (error) {
                ZoweLogger.warn(`[ConfigEditor] Could not load localization file: ${String(error)}`);
            }
        }
    }

    private async loadConfigData(): Promise<void> {
        try {
            // Find config file using the same logic as display()
            this.configPath = await ConfigEditor.findConfigFile();

            if (!this.configPath) {
                throw new Error("No zowe.config.json found in workspace or ~/.zowe directory");
            }

            // Read config file
            const configContent = await fs.readFile(this.configPath, { encoding: "utf8" });

            // Parse JSONC (JSON with Comments) - Zowe config files support comments
            try {
                // Strip comments and trailing commas before parsing
                const cleanedJson = this.stripJsonComments(configContent);
                this.configData = JSON.parse(cleanedJson);
            } catch (parseError) {
                const errorMsg = String(parseError);
                const lineMatch = errorMsg.match(/position (\d+)|line (\d+)/);
                const position = lineMatch ? lineMatch[1] || lineMatch[2] : "unknown";
                throw new Error(
                    `Invalid JSON in config file near position ${position}. Please check for syntax errors, comments, or trailing commas.`
                );
            }

            ZoweLogger.info(`[ConfigEditor] Loaded config from: ${this.configPath}`);
        } catch (error) {
            ZoweLogger.error(`[ConfigEditor] Failed to load config: ${String(error)}`);
            throw error;
        }
    }

    /**
     * Strip comments and trailing commas from JSON content
     * This allows parsing of JSONC (JSON with Comments) files
     */
    private stripJsonComments(jsonString: string): string {
        // Remove single-line comments (// ...)
        let result = jsonString.replace(/\/\/.*$/gm, "");

        // Remove multi-line comments (/* ... */)
        result = result.replace(/\/\*[\s\S]*?\*\//g, "");

        // Remove trailing commas before closing braces/brackets
        result = result.replace(/,(\s*[}\]])/g, "$1");

        return result;
    }

    private async sendConfigData(requestId: string): Promise<void> {
        if (!this.configData) {
            await this.loadConfigData();
        }

        await this.panel.webview.postMessage({
            requestId,
            payload: this.configData,
        });
    }

    /**
     * Parse schema properties from conditional if/then blocks in allOf array
     * This method correctly extracts properties from the Zowe schema structure
     */
    private parseSchemaFromAllOf(schema: any): Record<string, string[]> {
        const profileTypeSchemas: Record<string, string[]> = {};

        try {
            // Navigate to the profile pattern properties
            if (!schema?.properties?.profiles?.patternProperties) {
                return profileTypeSchemas;
            }

            const patternProps = schema.properties.profiles.patternProperties;

            // Iterate through pattern properties (usually "^\\S*$")
            for (const pattern of Object.keys(patternProps)) {
                const profileDef = patternProps[pattern];

                // Check if allOf array exists
                if (!profileDef.allOf || !Array.isArray(profileDef.allOf)) {
                    continue;
                }

                // Iterate through allOf conditions
                for (const condition of profileDef.allOf) {
                    // Look for if/then blocks
                    if (condition.if && condition.then) {
                        // Extract profile type from the if condition
                        const profileType = condition.if?.properties?.type?.const;

                        if (profileType && condition.then?.properties?.properties?.properties) {
                            // Navigate to the actual properties: then.properties.properties.properties
                            const actualProperties = condition.then.properties.properties.properties;
                            const propertyNames = Object.keys(actualProperties);

                            profileTypeSchemas[profileType] = propertyNames;

                            ZoweLogger.trace(
                                `[ConfigEditor] Extracted ${String(propertyNames.length)} properties for profile type '${String(
                                    profileType
                                )}': ${propertyNames.join(", ")}`
                            );
                        }
                    }
                }
            }
        } catch (error) {
            ZoweLogger.error(`[ConfigEditor] Error parsing schema allOf blocks: ${String(error)}`);
        }

        return profileTypeSchemas;
    }

    /**
     * Get schema properties for each profile type
     */
    private async getProfileTypeSchemas(): Promise<Record<string, string[]>> {
        try {
            let profileTypeSchemas: Record<string, string[]> = {};

            // Try to read the schema file
            if (this.configPath) {
                const schemaPath = path.join(path.dirname(this.configPath), "zowe.schema.json");
                try {
                    const schemaContent = await fs.readFile(schemaPath, { encoding: "utf8" });
                    const schema = JSON.parse(schemaContent);

                    ZoweLogger.trace(`[ConfigEditor] Successfully loaded schema from: ${schemaPath}`);

                    // Use the new parsing method
                    profileTypeSchemas = this.parseSchemaFromAllOf(schema);
                } catch (schemaError) {
                    ZoweLogger.trace(`[ConfigEditor] Could not read schema file: ${String(schemaError)}`);
                }
            }

            // Fallback: Define common properties for known profile types if schema parsing failed
            if (Object.keys(profileTypeSchemas).length === 0) {
                ZoweLogger.trace("[ConfigEditor] Using fallback property definitions");
                profileTypeSchemas["zosmf"] = [
                    "host",
                    "port",
                    "user",
                    "password",
                    "rejectUnauthorized",
                    "basePath",
                    "protocol",
                    "encoding",
                    "responseTimeout",
                ];
                profileTypeSchemas["rse"] = ["host", "port", "basePath", "protocol", "rejectUnauthorized"];
                profileTypeSchemas["base"] = ["host", "port", "user", "password", "rejectUnauthorized"];
                profileTypeSchemas["tso"] = ["account", "codePage", "logonProcedure", "characterSet", "rows", "columns"];
                profileTypeSchemas["ssh"] = ["host", "port", "user", "password", "privateKey", "keyPassphrase", "handshakeTimeout"];
                profileTypeSchemas["ftp"] = ["host", "port", "user", "password", "secureFtp"];
                profileTypeSchemas["cics"] = ["host", "port", "user", "password", "regionName", "cicsPlex", "rejectUnauthorized", "protocol"];
            }

            return profileTypeSchemas;
        } catch (error) {
            ZoweLogger.error(`[ConfigEditor] Failed to get profile type schemas: ${String(error)}`);
            // Return empty object if we can't get schemas
            return {};
        }
    }

    private async sendProfileSchemas(requestId: string): Promise<void> {
        const schemas = await this.getProfileTypeSchemas();

        await this.panel.webview.postMessage({
            requestId,
            payload: schemas,
        });
    }

    /**
     * Get authentication type for all profiles
     */
    private async sendProfileStatus(requestId: string): Promise<void> {
        try {
            const profileStatus: Record<string, { authType: string; loggedIn: boolean }> = {};

            if (this.configData?.profiles) {
                const profilesCache = Profiles.getInstance();
                const profileInfo = await profilesCache.getProfileInfo();

                for (const profileName of Object.keys(this.configData.profiles)) {
                    try {
                        const profileData = this.configData.profiles[profileName];
                        const properties = profileData.properties || {};
                        const secureFields = profileData.secure || [];
                        const teamConfig = profileInfo.getTeamConfig();

                        let authType = "None";
                        let loggedIn = false;

                        // Check for basic auth credentials (user/password)
                        const hasUser = secureFields.includes("user") || !!properties.user;
                        const hasPassword = secureFields.includes("password") || !!properties.password;

                        if (hasUser && hasPassword) {
                            authType = "Basic";
                            loggedIn = true;
                        }

                        // Check for token-based auth
                        const hasTokenValue = secureFields.includes("tokenValue") || !!properties.tokenValue;
                        if (hasTokenValue) {
                            // Check if it's stored securely
                            const profPath = teamConfig.api.profiles.getProfilePathFromName(profileName);
                            const isSecureToken = teamConfig.api.secure.secureFields().includes(profPath + ".properties.tokenValue");

                            if (isSecureToken || properties.tokenValue) {
                                authType = properties.tokenType || "Token";
                                loggedIn = true;
                            }
                        }

                        // Check for certificate auth
                        const hasCertFile = secureFields.includes("certFile") || !!properties.certFile;
                        const hasCertKeyFile = secureFields.includes("certKeyFile") || !!properties.certKeyFile;
                        if (hasCertFile && hasCertKeyFile) {
                            authType = "Certificate";
                            loggedIn = true;
                        }

                        profileStatus[profileName] = {
                            authType: authType,
                            loggedIn: loggedIn,
                        };
                    } catch (error) {
                        // Profile might not be loadable, mark as no auth
                        ZoweLogger.trace(`[ConfigEditor] Could not check status for profile ${profileName}: ${String(error)}`);
                        profileStatus[profileName] = {
                            authType: "Unknown",
                            loggedIn: false,
                        };
                    }
                }
            }

            await this.panel.webview.postMessage({
                requestId,
                payload: profileStatus,
            });
        } catch (error) {
            ZoweLogger.error(`[ConfigEditor] Failed to get profile status: ${String(error)}`);
            throw error;
        }
    }

    private async updateConfigData(updateMessage: UpdateConfigMessage, requestId: string): Promise<void> {
        if (!this.configData || !this.configPath) {
            throw new Error("Config data not loaded");
        }

        const { section, rowData, field, newValue } = updateMessage;

        try {
            // Update the in-memory config data based on the section
            switch (section) {
                case "Profiles":
                    if (this.configData.profiles && rowData.profileName) {
                        const profileName = rowData.profileName;
                        if (!this.configData.profiles[profileName]) {
                            this.configData.profiles[profileName] = { type: rowData.type || "", properties: {} };
                        }

                        if (field === "type") {
                            this.configData.profiles[profileName].type = newValue;
                        } else if (field !== "profileName") {
                            // Update property
                            if (!this.configData.profiles[profileName].properties) {
                                this.configData.profiles[profileName].properties = {};
                            }
                            this.configData.profiles[profileName].properties[field] = newValue;
                        }
                    }
                    break;

                case "Defaults":
                    if (this.configData.defaults && rowData.setting) {
                        // Try to parse as JSON if it looks like an object/array
                        let parsedValue = newValue;
                        if (typeof newValue === "string" && (newValue.startsWith("{") || newValue.startsWith("["))) {
                            try {
                                parsedValue = JSON.parse(newValue);
                            } catch {
                                // Keep as string if parsing fails
                            }
                        }
                        this.configData.defaults[rowData.setting] = parsedValue;
                    }
                    break;

                case "Other Settings":
                    if (rowData.property) {
                        // Try to parse as JSON if it looks like an object/array
                        let parsedValue = newValue;
                        if (typeof newValue === "string" && (newValue.startsWith("{") || newValue.startsWith("["))) {
                            try {
                                parsedValue = JSON.parse(newValue);
                            } catch {
                                // Keep as string if parsing fails
                            }
                        }
                        this.configData[rowData.property] = parsedValue;
                    }
                    break;

                default:
                    throw new Error(`Unknown section: ${section}`);
            }

            // Write updated config back to file
            const formattedConfig = JSON.stringify(this.configData, null, 2);
            await fs.writeFile(this.configPath, formattedConfig, { encoding: "utf8" });

            ZoweLogger.info(`[ConfigEditor] Updated config: ${section} - ${field} = ${String(newValue)}`);

            // Send success response
            await this.panel.webview.postMessage({
                requestId,
                payload: { success: true },
            });
        } catch (error) {
            ZoweLogger.error(`[ConfigEditor] Failed to update config: ${String(error)}`);
            throw error;
        }
    }

    private async addConfigRow(addMessage: { section: string; rowData: any }, requestId: string): Promise<void> {
        if (!this.configData || !this.configPath) {
            throw new Error("Config data not loaded");
        }

        const { section, rowData } = addMessage;

        try {
            switch (section) {
                case "Profiles":
                    if (this.configData.profiles && rowData.profileName) {
                        const profileName = rowData.profileName;
                        // Create new profile
                        this.configData.profiles[profileName] = {
                            type: rowData.type || "zosmf",
                            properties: {},
                        };

                        // Add other properties
                        Object.keys(rowData).forEach((key) => {
                            if (key !== "profileName" && key !== "type" && rowData[key]) {
                                if (this.configData.profiles && this.configData.profiles[profileName]) {
                                    this.configData.profiles[profileName].properties[key] = rowData[key];
                                }
                            }
                        });
                    }
                    break;

                case "Defaults":
                    if (this.configData.defaults && rowData.setting) {
                        let parsedValue = rowData.value;
                        if (typeof rowData.value === "string" && (rowData.value.startsWith("{") || rowData.value.startsWith("["))) {
                            try {
                                parsedValue = JSON.parse(rowData.value);
                            } catch {
                                // Keep as string if parsing fails
                            }
                        }
                        this.configData.defaults[rowData.setting] = parsedValue;
                    }
                    break;

                case "Other Settings":
                    if (rowData.property) {
                        let parsedValue = rowData.value;
                        if (typeof rowData.value === "string" && (rowData.value.startsWith("{") || rowData.value.startsWith("["))) {
                            try {
                                parsedValue = JSON.parse(rowData.value);
                            } catch {
                                // Keep as string if parsing fails
                            }
                        }
                        this.configData[rowData.property] = parsedValue;
                    }
                    break;

                default:
                    throw new Error(`Unknown section: ${section}`);
            }

            // Write updated config back to file
            const formattedConfig = JSON.stringify(this.configData, null, 2);
            await fs.writeFile(this.configPath, formattedConfig, { encoding: "utf8" });

            ZoweLogger.info(`[ConfigEditor] Added row to ${section}`);

            // Send success response
            await this.panel.webview.postMessage({
                requestId,
                payload: { success: true },
            });
        } catch (error) {
            ZoweLogger.error(`[ConfigEditor] Failed to add row: ${String(error)}`);
            throw error;
        }
    }

    private async deleteConfigRow(deleteMessage: { section: string; rowData: any }, requestId: string): Promise<void> {
        if (!this.configData || !this.configPath) {
            throw new Error("Config data not loaded");
        }

        const { section, rowData } = deleteMessage;

        try {
            switch (section) {
                case "Profiles":
                    if (this.configData.profiles && rowData.profileName) {
                        delete this.configData.profiles[rowData.profileName];
                    }
                    break;

                case "Defaults":
                    if (this.configData.defaults && rowData.setting) {
                        delete this.configData.defaults[rowData.setting];
                    }
                    break;

                case "Other Settings":
                    if (rowData.property) {
                        delete this.configData[rowData.property];
                    }
                    break;

                default:
                    throw new Error(`Unknown section: ${section}`);
            }

            // Write updated config back to file
            const formattedConfig = JSON.stringify(this.configData, null, 2);
            await fs.writeFile(this.configPath, formattedConfig, { encoding: "utf8" });

            ZoweLogger.info(`[ConfigEditor] Deleted row from ${section}`);

            // Send success response
            await this.panel.webview.postMessage({
                requestId,
                payload: { success: true },
            });
        } catch (error) {
            ZoweLogger.error(`[ConfigEditor] Failed to delete row: ${String(error)}`);
            throw error;
        }
    }
}
