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

import { useEffect, useState } from "preact/hooks";
import { getVsCodeTheme, useMutableObserver } from "../utils";
import { messageHandler } from "../MessageHandler";
import "./style.css";

interface ConfigData {
  profiles?: Record<string, any>;
  defaults?: Record<string, any>;
  autoStore?: boolean;
  [key: string]: any;
}

interface Column {
  field: string;
  headerName: string;
  editable: boolean;
}

interface ProfileGroup {
  type: string;
  profiles: ProfileRow[];
  columns: Column[];
  expanded: boolean;
}

interface ProfileRow {
  profileName: string;
  type: string;
  authType: string;
  [key: string]: any;
}

interface SimpleRow {
  [key: string]: any;
}

// Auth Type icon component
const AuthTypeIcon = ({ authType }: { authType: string }) => {
  let icon = "codicon-circle-slash";
  let color = "var(--vscode-errorForeground)";

  switch (authType) {
    case "Basic":
      icon = "codicon-key";
      color = "var(--vscode-testing-iconPassed)";
      break;
    case "Token":
    case "apimlAuthenticationToken":
    case "bearer-token":
      icon = "codicon-verified";
      color = "var(--vscode-charts-blue)";
      break;
    case "Certificate":
      icon = "codicon-file-certificate";
      color = "var(--vscode-charts-green)";
      break;
    case "None":
    case "Unknown":
      icon = "codicon-circle-slash";
      color = "var(--vscode-errorForeground)";
      break;
    default:
      icon = "codicon-question";
      color = "var(--vscode-charts-yellow)";
  }

  return (
    <span>
      <span className={`codicon ${icon}`} style={{ color, marginRight: "6px" }}></span>
      {authType}
    </span>
  );
};

export function App() {
  const [theme, setTheme] = useState<string>("light");
  const [configData, setConfigData] = useState<ConfigData | null>(null);
  const [profileGroups, setProfileGroups] = useState<ProfileGroup[]>([]);
  const [defaultsData, setDefaultsData] = useState<SimpleRow[]>([]);
  const [otherData, setOtherData] = useState<SimpleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ section: string; groupIndex?: number; rowIndex: number; field: string } | null>(null);
  const [addingProfileType, setAddingProfileType] = useState<boolean>(false);
  const [newProfileTypeName, setNewProfileTypeName] = useState<string>("");
  const [modifiedProfiles, setModifiedProfiles] = useState<Set<string>>(new Set());

  // Column resizing functionality
  useEffect(() => {
    const initColumnResize = () => {
      const tables = document.querySelectorAll(".config-table");

      tables.forEach((table) => {
        const headers = table.querySelectorAll("th");

        // Add resize handles only (CSS widths are already set)
        headers.forEach((th) => {
          const thElement = th as HTMLElement;
          // Skip if resize handle already exists or if it's a fixed column
          if (
            thElement.querySelector(".resize-handle") ||
            thElement.classList.contains("indent-cell") ||
            thElement.classList.contains("actions-column")
          ) {
            return;
          }

          const resizeHandle = document.createElement("div");
          resizeHandle.className = "resize-handle";
          thElement.appendChild(resizeHandle);

          let startX = 0;
          let startWidth = 0;

          const onMouseDown = (e: MouseEvent) => {
            e.preventDefault();
            startX = e.pageX;
            startWidth = thElement.offsetWidth;
            resizeHandle.classList.add("resizing");

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
          };

          const onMouseMove = (e: MouseEvent) => {
            const diff = e.pageX - startX;
            const newWidth = Math.max(80, startWidth + diff); // Minimum 80px (matches CSS min-width)
            thElement.style.width = `${newWidth}px`;
          };

          const onMouseUp = () => {
            resizeHandle.classList.remove("resizing");
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
          };

          resizeHandle.addEventListener("mousedown", onMouseDown);
        });
      });
    };

    // Initialize after a short delay to ensure DOM is ready
    const timer = setTimeout(initColumnResize, 100);
    return () => clearTimeout(timer);
  }, [profileGroups, defaultsData, otherData]);

  useEffect(() => {
    // Apply theme
    const userTheme = getVsCodeTheme();
    setTheme(userTheme === "vscode-light" ? "light" : "dark");

    // Request config data from extension
    const loadConfigData = async () => {
      try {
        const data = await messageHandler.request<ConfigData>("get-config-data");
        setConfigData(data);

        // Request profile auth type
        const status = await messageHandler.request<Record<string, { authType: string; loggedIn: boolean }>>("get-profile-status");

        // Request profile schemas
        const schemas = await messageHandler.request<Record<string, string[]>>("get-profile-schemas");

        processConfigData(data, status, schemas);
      } catch (err) {
        setError(`Failed to load config data: ${err}`);
      }
    };

    loadConfigData();
    messageHandler.send("ready");
  }, []);

  // Observe attributes of the `body` element to detect VS Code theme changes.
  useMutableObserver(
    document.body,
    (_mutations, _observer) => {
      const themeAttr = getVsCodeTheme();
      setTheme(themeAttr === "vscode-light" ? "light" : "dark");
    },
    { attributes: true }
  );

  const processConfigData = (
    data: ConfigData,
    status?: Record<string, { authType: string; loggedIn: boolean }>,
    schemas?: Record<string, string[]>
  ) => {
    console.log("processConfigData called", {
      hasProfiles: !!data.profiles,
      profileCount: data.profiles ? Object.keys(data.profiles).length : 0,
      schemas,
    });

    // Process profiles - group by type (handles both flat and nested structures)
    if (data.profiles) {
      const profilesByType: Record<string, ProfileRow[]> = {};

      // Recursive function to process profiles at any level
      const processProfile = (profileName: string, profileConfig: any, parentName?: string) => {
        if (typeof profileConfig !== "object" || profileConfig === null) {
          return;
        }

        const profileType = profileConfig.type || "base";
        const fullProfileName = parentName ? `${parentName}.${profileName}` : profileName;

        console.log(`Processing profile: ${fullProfileName}, type: ${profileType}`, profileConfig);

        const flatProfile: ProfileRow = {
          profileName: profileName, // Store only the profile name, not the full path
          type: profileType,
          authType: status?.[fullProfileName]?.authType || status?.[profileName]?.authType || "Unknown",
          parent: parentName || "", // Always include parent field (empty for top-level profiles)
          _fullPath: fullProfileName, // Store full path for internal use
        };

        // Flatten properties
        if (profileConfig.properties) {
          Object.entries(profileConfig.properties).forEach(([key, value]) => {
            flatProfile[key] = value;
          });
        }

        // Group by type
        if (!profilesByType[profileType]) {
          profilesByType[profileType] = [];
        }
        profilesByType[profileType].push(flatProfile);

        // Process nested profiles recursively
        if (profileConfig.profiles) {
          Object.entries(profileConfig.profiles).forEach(([nestedName, nestedConfig]) => {
            processProfile(nestedName, nestedConfig, fullProfileName);
          });
        }
      };

      // Process all top-level profiles
      Object.entries(data.profiles).forEach(([profileName, profileConfig]) => {
        processProfile(profileName, profileConfig);
      });

      console.log("profilesByType:", profilesByType);

      // Create profile groups with columns
      const groups: ProfileGroup[] = Object.entries(profilesByType).map(([profileType, profiles]) => {
        // Get allowed properties for this profile type from schema
        const allowedProperties = schemas?.[profileType] || null;
        console.log(`Creating group for ${profileType}, allowedProperties:`, allowedProperties);

        // Build set of all keys to display
        const allKeys = new Set<string>();

        // Always include core fields
        allKeys.add("profileName");

        // If we have schema properties, include ALL of them (even if not populated)
        if (allowedProperties && allowedProperties.length > 0) {
          allowedProperties.forEach((prop) => allKeys.add(prop));
        }

        // Also include any additional keys found in profiles (for properties not in schema)
        profiles.forEach((profile) => {
          Object.keys(profile).forEach((key) => {
            if (key !== "type" && key !== "authType" && key !== "parent") {
              allKeys.add(key);
            }
          });
        });

        console.log(`Keys for ${profileType}:`, Array.from(allKeys));

        // Ensure all profiles have all properties (fill with empty string if missing)
        profiles.forEach((profile) => {
          allKeys.forEach((key) => {
            if (!(key in profile)) {
              profile[key] = "";
            }
          });
        });

        // Build columns - ALWAYS include Parent column
        const columns: Column[] = [
          { field: "authType", headerName: "Auth Type", editable: false },
          { field: "parent", headerName: "Parent", editable: true },
          ...Array.from(allKeys)
            .filter((key) => key !== "authType" && key !== "type" && key !== "parent" && key !== "_fullPath")
            .map((key) => ({
              field: key,
              headerName: key.charAt(0).toUpperCase() + key.slice(1),
              editable: true, // Make all columns editable including profileName
            })),
        ];

        return {
          type: profileType,
          profiles,
          columns,
          expanded: false, // Start collapsed
        };
      });

      console.log("Created groups:", groups);
      setProfileGroups(groups);
    }

    // Process defaults
    if (data.defaults) {
      const defaults = Object.entries(data.defaults).map(([key, value]) => ({
        setting: key,
        value: typeof value === "object" ? JSON.stringify(value) : String(value),
      }));
      setDefaultsData(defaults);
    }

    // Process other top-level properties
    const otherProps = Object.entries(data).filter(([key]) => key !== "profiles" && key !== "defaults" && key !== "$schema");

    if (otherProps.length > 0) {
      const other = otherProps.map(([key, value]) => ({
        property: key,
        value: typeof value === "object" ? JSON.stringify(value) : String(value),
      }));
      setOtherData(other);
    }
  };

  const toggleGroup = (groupIndex: number) => {
    setProfileGroups((prev) => prev.map((group, idx) => (idx === groupIndex ? { ...group, expanded: !group.expanded } : group)));
  };

  const handleCellEdit = (section: string, groupIndex: number | undefined, rowIndex: number, field: string, newValue: string) => {
    try {
      // Update local state only (don't save to backend yet)
      if (section === "profiles" && groupIndex !== undefined) {
        const profile = profileGroups[groupIndex].profiles[rowIndex];
        const profileIdentifier = profile._fullPath || profile.profileName;

        setProfileGroups((prev) =>
          prev.map((group, idx) =>
            idx === groupIndex
              ? {
                  ...group,
                  profiles: group.profiles.map((p, pIdx) => {
                    if (pIdx === rowIndex) {
                      const updatedProfile = { ...p, [field]: newValue };
                      // Update _fullPath when parent or profileName changes
                      if (field === "parent" || field === "profileName") {
                        const newParent = field === "parent" ? newValue : p.parent;
                        const newName = field === "profileName" ? newValue : p.profileName;
                        updatedProfile._fullPath = newParent ? `${newParent}.${newName}` : newName;
                      }
                      return updatedProfile;
                    }
                    return p;
                  }),
                }
              : group
          )
        );

        // Mark this profile as modified (use _fullPath for identification)
        setModifiedProfiles((prev) => new Set(prev).add(profileIdentifier));
      } else if (section === "defaults") {
        setDefaultsData((prev) => prev.map((row, idx) => (idx === rowIndex ? { ...row, [field]: newValue } : row)));
      } else {
        setOtherData((prev) => prev.map((row, idx) => (idx === rowIndex ? { ...row, [field]: newValue } : row)));
      }

      setEditingCell(null);
    } catch (err) {
      messageHandler.send("show-error", { message: `Failed to update cell: ${err}` });
    }
  };

  const handleSaveProfile = async (groupIndex: number, rowIndex: number) => {
    try {
      const group = profileGroups[groupIndex];
      const profile = group.profiles[rowIndex];
      const sectionTitle = `Profiles: ${group.type.toUpperCase()}`;
      const profileIdentifier = profile._fullPath || profile.profileName;

      // Send the entire profile data to backend for saving
      await messageHandler.request("save-profile", {
        section: sectionTitle,
        profileData: profile,
      });

      // Remove from modified set (use _fullPath for identification)
      setModifiedProfiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(profileIdentifier);
        return newSet;
      });
    } catch (err) {
      messageHandler.send("show-error", { message: `Failed to save profile: ${err}` });
    }
  };

  const handleDeleteRow = async (section: string, groupIndex: number | undefined, rowIndex: number) => {
    try {
      let rowData: any;
      let sectionTitle: string;

      if (section === "profiles" && groupIndex !== undefined) {
        rowData = profileGroups[groupIndex].profiles[rowIndex];
        sectionTitle = `Profiles: ${profileGroups[groupIndex].type.toUpperCase()}`;
      } else if (section === "defaults") {
        rowData = defaultsData[rowIndex];
        sectionTitle = "Defaults";
      } else {
        rowData = otherData[rowIndex];
        sectionTitle = "Other Settings";
      }

      await messageHandler.request("delete-config-row", {
        section: sectionTitle,
        rowData,
      });

      // Update local state
      if (section === "profiles" && groupIndex !== undefined) {
        setProfileGroups((prev) =>
          prev.map((group, idx) =>
            idx === groupIndex
              ? {
                  ...group,
                  profiles: group.profiles.filter((_, pIdx) => pIdx !== rowIndex),
                }
              : group
          )
        );
      } else if (section === "defaults") {
        setDefaultsData((prev) => prev.filter((_, idx) => idx !== rowIndex));
      } else {
        setOtherData((prev) => prev.filter((_, idx) => idx !== rowIndex));
      }
    } catch (err) {
      setError(`Failed to delete row: ${err}`);
    }
  };

  const handleAddRow = async (section: string, groupIndex?: number) => {
    try {
      // Just add row locally - user will fill in values and they'll be saved on edit
      if (section === "profiles" && groupIndex !== undefined) {
        const group = profileGroups[groupIndex];
        const profileType = group.type;

        // Create new profile with all columns from the group
        const newProfile: ProfileRow = {
          profileName: "",
          type: profileType,
          authType: "None",
          parent: "", // Always include parent field
          _fullPath: "", // Internal tracking
        };

        // Initialize all other columns from the group's column definition
        group.columns.forEach((col) => {
          if (col.field !== "authType" && col.field !== "profileName" && col.field !== "parent" && col.field !== "_fullPath") {
            newProfile[col.field] = "";
          }
        });

        // Update local state immediately
        setProfileGroups((prev) =>
          prev.map((group, idx) =>
            idx === groupIndex
              ? {
                  ...group,
                  profiles: [...group.profiles, newProfile],
                }
              : group
          )
        );
      } else if (section === "defaults") {
        const newRow = { setting: "", value: "" };
        setDefaultsData((prev) => [...prev, newRow]);
      } else {
        const newRow = { property: "", value: "" };
        setOtherData((prev) => [...prev, newRow]);
      }
    } catch (err) {
      // Show error in VS Code instead of full-page error
      messageHandler.send("show-error", { message: `Failed to add row: ${err}` });
    }
  };

  const handleAddProfileType = () => {
    // Show the input row for adding a new profile type
    setAddingProfileType(true);
    setNewProfileTypeName("");
  };

  const handleValidateAndCreateProfileType = async () => {
    try {
      const trimmedType = newProfileTypeName.trim().toLowerCase();

      if (!trimmedType) {
        setAddingProfileType(false);
        setNewProfileTypeName("");
        return;
      }

      // Request valid profile types and schemas from backend
      const validTypes = await messageHandler.request<string[]>("get-valid-profile-types");
      const schemas = await messageHandler.request<Record<string, string[]>>("get-profile-schemas");

      // Check if profile type already exists
      if (profileGroups.some((group) => group.type === trimmedType)) {
        messageHandler.send("show-error", {
          message: `Profile type "${trimmedType}" already exists.`,
        });
        setAddingProfileType(false);
        setNewProfileTypeName("");
        return;
      }

      // Validate against schema
      if (!validTypes.includes(trimmedType)) {
        messageHandler.send("show-error", {
          message: `"${trimmedType}" is not a valid profile type. Valid types are: ${validTypes.join(", ")}`,
        });
        setAddingProfileType(false);
        setNewProfileTypeName("");
        return;
      }

      // Get schema properties for this profile type
      const allowedProperties = schemas?.[trimmedType] || [];

      // Build columns from schema properties
      const allKeys = new Set<string>();
      allKeys.add("profileName");
      allKeys.add("parent"); // Always include parent column
      allowedProperties.forEach((prop) => allKeys.add(prop));

      const columns: Column[] = [
        { field: "authType", headerName: "Auth Type", editable: false },
        ...Array.from(allKeys)
          .filter((key) => key !== "authType" && key !== "type" && key !== "_fullPath")
          .map((key) => ({
            field: key,
            headerName: key.charAt(0).toUpperCase() + key.slice(1),
            editable: true,
          })),
      ];

      const newGroup: ProfileGroup = {
        type: trimmedType,
        profiles: [], // Start with no profiles - user will add using "Add Row" button
        columns,
        expanded: true, // Start expanded
      };

      // Update local state - user will add profiles using "Add Row" button
      setProfileGroups((prev) => [...prev, newGroup]);

      // Reset the adding state
      setAddingProfileType(false);
      setNewProfileTypeName("");
    } catch (err) {
      messageHandler.send("show-error", { message: `Failed to add profile type: ${err}` });
      setAddingProfileType(false);
      setNewProfileTypeName("");
    }
  };

  const handleCancelAddProfileType = () => {
    setAddingProfileType(false);
    setNewProfileTypeName("");
  };

  if (error) {
    return (
      <div className="config-editor-error">
        <h2>Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!configData) {
    return (
      <div className="config-editor-loading">
        <p>Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className={`config-editor theme-${theme}`}>
      <div className="config-editor-header">
        <h1>Zowe Configuration Editor</h1>
        <p className="config-editor-description">Edit your Zowe configuration settings. Changes are saved automatically.</p>
      </div>

      {/* Debug Info */}
      <div className="config-section">
        <p>Profile Groups Count: {profileGroups.length}</p>
        <p>Config Data: {configData ? "Loaded" : "Not Loaded"}</p>
        {configData?.profiles && <p>Profiles in config: {Object.keys(configData.profiles).length}</p>}
      </div>

      {/* Profiles Section with Accordion-style Grouping */}
      <div className="config-section">
        <div className="config-section-header">
          <h2>Profiles</h2>
          <button className="add-row-btn" onClick={handleAddProfileType}>
            <span className="codicon codicon-add"></span>
            Add Profile Type
          </button>
        </div>

        {profileGroups.length > 0 || addingProfileType ? (
          <div className="table-container">
            <table className="config-table">
              <tbody>
                {/* New Profile Type Input Row */}
                {addingProfileType && (
                  <tr className="group-row new-profile-type-row">
                    <td className="group-cell" colSpan={100}>
                      <div className="group-cell-content">
                        <span className="codicon codicon-symbol-class" style={{ color: "var(--vscode-charts-blue)" }}></span>
                        <input
                          type="text"
                          className="profile-type-input"
                          placeholder="Enter profile type name (e.g., zosmf, ssh, ftp)"
                          value={newProfileTypeName}
                          onChange={(e) => setNewProfileTypeName((e.target as HTMLInputElement).value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleValidateAndCreateProfileType();
                            } else if (e.key === "Escape") {
                              handleCancelAddProfileType();
                            }
                          }}
                          onBlur={handleValidateAndCreateProfileType}
                          autoFocus
                        />
                        <button className="icon-btn" onClick={handleValidateAndCreateProfileType} title="Create Profile Type">
                          <span className="codicon codicon-check"></span>
                        </button>
                        <button className="icon-btn" onClick={handleCancelAddProfileType} title="Cancel">
                          <span className="codicon codicon-close"></span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {profileGroups.map((group, groupIndex) => (
                  <>
                    {/* Parent Row - Profile Type Group */}
                    <tr key={`group-${groupIndex}`} className="group-row" onClick={() => toggleGroup(groupIndex)}>
                      <td className="group-cell" colSpan={100}>
                        <div className="group-cell-content">
                          <span className={`codicon ${group.expanded ? "codicon-chevron-down" : "codicon-chevron-right"}`}></span>
                          <span className="group-title">{group.type.toUpperCase()}</span>
                          <span className="group-count">({group.profiles.length})</span>
                          <button
                            className="add-row-btn-inline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddRow("profiles", groupIndex);
                            }}
                          >
                            <span className="codicon codicon-add"></span>
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Child Rows - Header and Individual Profiles */}
                    {group.expanded && (
                      <>
                        {/* Column Headers for this group */}
                        <tr key={`header-${groupIndex}`} className="child-header-row">
                          <th className="indent-cell"></th>
                          {group.columns.map((col) => (
                            <th key={col.field}>{col.headerName}</th>
                          ))}
                          <th className="actions-column">Actions</th>
                        </tr>

                        {/* Profile Rows */}
                        {group.profiles.map((profile, rowIndex) => (
                          <tr key={`profile-${groupIndex}-${rowIndex}`} className={`child-row ${profile.parent ? "nested-profile" : ""}`}>
                            <td className="indent-cell"></td>
                            {group.columns.map((col) => (
                              <td key={col.field}>
                                {col.field === "parent" ? (
                                  col.editable &&
                                  editingCell?.section === "profiles" &&
                                  editingCell?.groupIndex === groupIndex &&
                                  editingCell?.rowIndex === rowIndex &&
                                  editingCell?.field === col.field ? (
                                    <input
                                      type="text"
                                      className="cell-input"
                                      defaultValue={profile.parent || ""}
                                      autoFocus
                                      onBlur={(e) => handleCellEdit("profiles", groupIndex, rowIndex, col.field, e.currentTarget.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          handleCellEdit("profiles", groupIndex, rowIndex, col.field, e.currentTarget.value);
                                        } else if (e.key === "Escape") {
                                          setEditingCell(null);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className={col.editable ? "editable-cell" : ""}
                                      onClick={() => col.editable && setEditingCell({ section: "profiles", groupIndex, rowIndex, field: col.field })}
                                    >
                                      {profile.parent || ""}
                                    </div>
                                  )
                                ) : col.field === "profileName" ? (
                                  col.editable &&
                                  editingCell?.section === "profiles" &&
                                  editingCell?.groupIndex === groupIndex &&
                                  editingCell?.rowIndex === rowIndex &&
                                  editingCell?.field === col.field ? (
                                    <input
                                      type="text"
                                      className="cell-input"
                                      defaultValue={profile[col.field] || ""}
                                      autoFocus
                                      onBlur={(e) => handleCellEdit("profiles", groupIndex, rowIndex, col.field, e.currentTarget.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          handleCellEdit("profiles", groupIndex, rowIndex, col.field, e.currentTarget.value);
                                        } else if (e.key === "Escape") {
                                          setEditingCell(null);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className={col.editable ? "editable-cell" : ""}
                                      onClick={() => col.editable && setEditingCell({ section: "profiles", groupIndex, rowIndex, field: col.field })}
                                    >
                                      {profile[col.field] !== undefined ? String(profile[col.field]) : ""}
                                    </div>
                                  )
                                ) : col.field === "authType" ? (
                                  <AuthTypeIcon authType={profile[col.field] || "None"} />
                                ) : col.field === "protocol" && col.editable ? (
                                  <select
                                    className="cell-select"
                                    value={profile[col.field] || "https"}
                                    onChange={(e) => handleCellEdit("profiles", groupIndex, rowIndex, col.field, e.currentTarget.value)}
                                  >
                                    <option value="https">https</option>
                                    <option value="http">http</option>
                                  </select>
                                ) : col.editable &&
                                  editingCell?.section === "profiles" &&
                                  editingCell?.groupIndex === groupIndex &&
                                  editingCell?.rowIndex === rowIndex &&
                                  editingCell?.field === col.field ? (
                                  <input
                                    type="text"
                                    className="cell-input"
                                    defaultValue={profile[col.field] || ""}
                                    autoFocus
                                    onBlur={(e) => handleCellEdit("profiles", groupIndex, rowIndex, col.field, e.currentTarget.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        handleCellEdit("profiles", groupIndex, rowIndex, col.field, e.currentTarget.value);
                                      } else if (e.key === "Escape") {
                                        setEditingCell(null);
                                      }
                                    }}
                                  />
                                ) : (
                                  <div
                                    className={col.editable ? "editable-cell" : ""}
                                    onClick={() => col.editable && setEditingCell({ section: "profiles", groupIndex, rowIndex, field: col.field })}
                                  >
                                    {profile[col.field] !== undefined ? String(profile[col.field]) : ""}
                                  </div>
                                )}
                              </td>
                            ))}
                            <td className="actions-column">
                              {modifiedProfiles.has(profile._fullPath || profile.profileName) && (
                                <button className="save-row-btn" onClick={() => handleSaveProfile(groupIndex, rowIndex)} title="Save changes">
                                  <span className="codicon codicon-save"></span>
                                </button>
                              )}
                              <button className="delete-row-btn" onClick={() => handleDeleteRow("profiles", groupIndex, rowIndex)}>
                                <span className="codicon codicon-trash"></span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No profile groups found. Click "Add Profile Type" to create one.</p>
        )}
      </div>

      {/* Defaults Section */}
      {defaultsData.length > 0 && (
        <div className="config-section">
          <div className="config-section-header">
            <h2>Defaults</h2>
            <button className="add-row-btn" onClick={() => handleAddRow("defaults")}>
              <span className="codicon codicon-add"></span> Add Row
            </button>
          </div>
          <div className="table-container">
            <table className="config-table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Value</th>
                  <th className="actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {defaultsData.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td>
                      {editingCell?.section === "defaults" && editingCell?.rowIndex === rowIndex && editingCell?.field === "setting" ? (
                        <input
                          type="text"
                          className="cell-input"
                          defaultValue={row.setting}
                          autoFocus
                          onBlur={(e) => handleCellEdit("defaults", undefined, rowIndex, "setting", e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleCellEdit("defaults", undefined, rowIndex, "setting", e.currentTarget.value);
                            } else if (e.key === "Escape") {
                              setEditingCell(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="non-editable-cell">{row.setting}</div>
                      )}
                    </td>
                    <td>
                      {editingCell?.section === "defaults" && editingCell?.rowIndex === rowIndex && editingCell?.field === "value" ? (
                        <input
                          type="text"
                          className="cell-input"
                          defaultValue={row.value}
                          autoFocus
                          onBlur={(e) => handleCellEdit("defaults", undefined, rowIndex, "value", e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleCellEdit("defaults", undefined, rowIndex, "value", e.currentTarget.value);
                            } else if (e.key === "Escape") {
                              setEditingCell(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="editable-cell" onClick={() => setEditingCell({ section: "defaults", rowIndex, field: "value" })}>
                          {row.value}
                        </div>
                      )}
                    </td>
                    <td className="actions-column">
                      <button
                        className="edit-row-btn"
                        onClick={() => setEditingCell({ section: "defaults", rowIndex, field: "value" })}
                        title="Edit value"
                      >
                        <span className="codicon codicon-edit"></span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Other Settings Section */}
      {otherData.length > 0 && (
        <div className="config-section">
          <div className="config-section-header">
            <h2>Other Settings</h2>
            <button className="add-row-btn" onClick={() => handleAddRow("other")}>
              <span className="codicon codicon-add"></span> Add Row
            </button>
          </div>
          <div className="table-container">
            <table className="config-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Value</th>
                  <th className="actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {otherData.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td>
                      {editingCell?.section === "other" && editingCell?.rowIndex === rowIndex && editingCell?.field === "property" ? (
                        <input
                          type="text"
                          className="cell-input"
                          defaultValue={row.property}
                          autoFocus
                          onBlur={(e) => handleCellEdit("other", undefined, rowIndex, "property", e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleCellEdit("other", undefined, rowIndex, "property", e.currentTarget.value);
                            } else if (e.key === "Escape") {
                              setEditingCell(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="editable-cell" onClick={() => setEditingCell({ section: "other", rowIndex, field: "property" })}>
                          {row.property}
                        </div>
                      )}
                    </td>
                    <td>
                      {editingCell?.section === "other" && editingCell?.rowIndex === rowIndex && editingCell?.field === "value" ? (
                        <input
                          type="text"
                          className="cell-input"
                          defaultValue={row.value}
                          autoFocus
                          onBlur={(e) => handleCellEdit("other", undefined, rowIndex, "value", e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleCellEdit("other", undefined, rowIndex, "value", e.currentTarget.value);
                            } else if (e.key === "Escape") {
                              setEditingCell(null);
                            }
                          }}
                        />
                      ) : (
                        <div className="editable-cell" onClick={() => setEditingCell({ section: "other", rowIndex, field: "value" })}>
                          {row.value}
                        </div>
                      )}
                    </td>
                    <td className="actions-column">
                      <button className="delete-row-btn" onClick={() => handleDeleteRow("other", undefined, rowIndex)}>
                        <span className="codicon codicon-trash"></span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
