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

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useRef, useState } from "preact/hooks";
import { getVsCodeTheme, useMutableObserver } from "../utils";
import { messageHandler } from "../MessageHandler";
import "./style.css";
import { ColDef, GridReadyEvent, CellValueChangedEvent } from "ag-grid-community";

import { provideGlobalGridOptions } from "ag-grid-community";

// Mark all grids as using legacy themes
provideGlobalGridOptions({
  theme: "legacy",
});

import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
ModuleRegistry.registerModules([AllCommunityModule]);

interface ConfigData {
  profiles?: Record<string, any>;
  defaults?: Record<string, any>;
  autoStore?: boolean;
  [key: string]: any;
}

interface TableSection {
  title: string;
  data: any[];
  columns: ColDef[];
}

// Status cell renderer
const StatusCellRenderer = (props: any) => {
  const isLoggedIn = props.value === "Logged In";
  const icon = isLoggedIn ? "codicon-check-all" : "codicon-circle-slash";
  const color = isLoggedIn ? "var(--vscode-testing-iconPassed)" : "var(--vscode-testing-iconFailed)";

  return (
    <span>
      <span className={`codicon ${icon}`} style={{ color, marginRight: "6px" }}></span>
      {props.value}
    </span>
  );
};

// Delete button cell renderer
const DeleteButtonRenderer = (props: any) => {
  const handleClick = () => {
    const sectionTitle = props.context.sectionTitle;
    const rowIndex = props.node.rowIndex;
    props.context.handleDeleteRow(sectionTitle, rowIndex);
  };

  return (
    <button className="delete-row-btn" onClick={handleClick}>
      <span className="codicon codicon-trash"></span>
    </button>
  );
};

export function App() {
  const [theme, setTheme] = useState<string>("ag-theme-quartz");
  const [configData, setConfigData] = useState<ConfigData | null>(null);
  const [tableSections, setTableSections] = useState<TableSection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const gridRefs = useRef<{ [key: string]: AgGridReact }>({});

  useEffect(() => {
    // Apply the dark version of the AG Grid theme if the user is using a dark or high-contrast theme in VS Code.
    const userTheme = getVsCodeTheme();
    if (userTheme !== "vscode-light") {
      setTheme("ag-theme-quartz-dark");
    }

    // Request config data from extension
    const loadConfigData = async () => {
      try {
        const data = await messageHandler.request<ConfigData>("get-config-data");
        setConfigData(data);

        // Also request profile status
        const status = await messageHandler.request<Record<string, { loggedIn: boolean; hasToken: boolean }>>("get-profile-status");

        processConfigData(data, status);
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
      setTheme(themeAttr === "vscode-light" ? "ag-theme-quartz" : "ag-theme-quartz-dark");
    },
    { attributes: true }
  );

  const processConfigData = (data: ConfigData, status?: Record<string, { loggedIn: boolean; hasToken: boolean }>) => {
    const sections: TableSection[] = [];

    // Process profiles
    if (data.profiles) {
      const profilesData: any[] = [];
      Object.entries(data.profiles).forEach(([profileName, profileConfig]) => {
        if (typeof profileConfig === "object" && profileConfig !== null) {
          const flatProfile: any = { profileName, type: profileConfig.type || "" };

          // Add login status
          if (status && status[profileName]) {
            flatProfile.status = status[profileName].loggedIn ? "Logged In" : "Not Logged In";
          } else {
            flatProfile.status = "Unknown";
          }

          // Flatten properties
          if (profileConfig.properties) {
            Object.entries(profileConfig.properties).forEach(([key, value]) => {
              flatProfile[key] = value;
            });
          }

          profilesData.push(flatProfile);
        }
      });

      if (profilesData.length > 0) {
        // Dynamically create columns based on all keys found
        const allKeys = new Set<string>();
        profilesData.forEach((profile) => {
          Object.keys(profile).forEach((key) => allKeys.add(key));
        });

        const profileColumns: ColDef[] = [
          // Type column for grouping
          {
            field: "type",
            headerName: "Type",
            editable: false,
            sortable: false,
            filter: false,
            resizable: true,
            flex: 1,
            rowGroup: true,
            hide: true,
          },
          // Status column first (with icon)
          {
            field: "status",
            headerName: "Status",
            editable: false,
            sortable: false,
            filter: false,
            resizable: true,
            flex: 1,
            cellRenderer: StatusCellRenderer,
          },
          ...Array.from(allKeys)
            .filter((key) => key !== "status" && key !== "type")
            .map((key) => ({
              field: key,
              headerName: key.charAt(0).toUpperCase() + key.slice(1),
              editable: key !== "profileName", // Profile name should not be editable
              sortable: false,
              filter: false,
              resizable: true,
              flex: 1,
            })),
          {
            field: "actions",
            headerName: "Actions",
            cellRenderer: DeleteButtonRenderer,
            editable: false,
            sortable: false,
            filter: false,
            width: 80,
            suppressSizeToFit: true,
          },
        ];

        sections.push({
          title: "Profiles",
          data: profilesData,
          columns: profileColumns,
        });
      }
    }

    // Process defaults
    if (data.defaults) {
      const defaultsData = Object.entries(data.defaults).map(([key, value]) => ({
        setting: key,
        value: typeof value === "object" ? JSON.stringify(value) : String(value),
      }));

      sections.push({
        title: "Defaults",
        data: defaultsData,
        columns: [
          { field: "setting", headerName: "Setting", editable: true, sortable: false, filter: false, resizable: true, flex: 1 },
          { field: "value", headerName: "Value", editable: true, sortable: false, filter: false, resizable: true, flex: 1 },
          {
            field: "actions",
            headerName: "Actions",
            cellRenderer: DeleteButtonRenderer,
            editable: false,
            sortable: false,
            filter: false,
            width: 80,
            suppressSizeToFit: true,
          },
        ],
      });
    }

    // Process other top-level properties
    const otherProps = Object.entries(data).filter(([key]) => key !== "profiles" && key !== "defaults" && key !== "$schema");

    if (otherProps.length > 0) {
      const otherData = otherProps.map(([key, value]) => ({
        property: key,
        value: typeof value === "object" ? JSON.stringify(value) : String(value),
      }));

      sections.push({
        title: "Other Settings",
        data: otherData,
        columns: [
          { field: "property", headerName: "Property", editable: true, sortable: false, filter: false, resizable: true, flex: 1 },
          { field: "value", headerName: "Value", editable: true, sortable: false, filter: false, resizable: true, flex: 1 },
          {
            field: "actions",
            headerName: "Actions",
            cellRenderer: DeleteButtonRenderer,
            editable: false,
            sortable: false,
            filter: false,
            width: 80,
            suppressSizeToFit: true,
          },
        ],
      });
    }

    setTableSections(sections);
  };

  const onCellValueChanged = async (event: CellValueChangedEvent, sectionTitle: string) => {
    // Send update to extension
    try {
      await messageHandler.request("update-config-data", {
        section: sectionTitle,
        rowData: event.data,
        field: event.colDef.field,
        oldValue: event.oldValue,
        newValue: event.newValue,
      });
    } catch (err) {
      setError(`Failed to update config: ${err}`);
      // Revert the change
      event.node.setDataValue(event.colDef.field!, event.oldValue);
    }
  };

  const onGridReady = (event: GridReadyEvent) => {
    // Auto-size columns to fit content
    event.api.sizeColumnsToFit();
  };

  const handleAddRow = (sectionTitle: string) => {
    const section = tableSections.find((s) => s.title === sectionTitle);
    if (!section) return;

    let newRow: any = {};

    // Create empty row based on section type
    if (sectionTitle === "Profiles") {
      newRow = { profileName: "new_profile", type: "zosmf" };
    } else if (sectionTitle === "Defaults") {
      newRow = { setting: "new_setting", value: "" };
    } else if (sectionTitle === "Other Settings") {
      newRow = { property: "new_property", value: "" };
    }

    // Add row to grid
    const gridRef = gridRefs.current[sectionTitle];
    if (gridRef?.api) {
      gridRef.api.applyTransaction({ add: [newRow] });

      // Send to backend to update config
      messageHandler
        .request("add-config-row", {
          section: sectionTitle,
          rowData: newRow,
        })
        .catch((err) => {
          setError(`Failed to add row: ${err}`);
          // Revert the add
          gridRef.api.applyTransaction({ remove: [newRow] });
        });
    }
  };

  const handleDeleteRow = async (sectionTitle: string, rowIndex: number) => {
    const gridRef = gridRefs.current[sectionTitle];
    if (!gridRef?.api) return;

    const rowNode = gridRef.api.getDisplayedRowAtIndex(rowIndex);
    if (!rowNode) return;

    const rowData = rowNode.data;

    try {
      await messageHandler.request("delete-config-row", {
        section: sectionTitle,
        rowData,
      });

      // Remove from grid
      gridRef.api.applyTransaction({ remove: [rowData] });
    } catch (err) {
      setError(`Failed to delete row: ${err}`);
    }
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
    <div className={`config-editor ${theme}`}>
      <div className="config-editor-header">
        <h1>Zowe Configuration Editor</h1>
        <p className="config-editor-description">Edit your Zowe configuration settings. Changes are saved automatically.</p>
      </div>

      {tableSections.map((section, index) => (
        <div key={index} className="config-section">
          <div className="config-section-header">
            <h2>{section.title}</h2>
            <button className="add-row-btn" onClick={() => handleAddRow(section.title)}>
              <span className="codicon codicon-add"></span> Add Row
            </button>
          </div>
          <div className={`${theme} ag-theme-vsc`} style={{ height: "400px", width: "100%" }}>
            <AgGridReact
              ref={(ref) => {
                if (ref) gridRefs.current[section.title] = ref;
              }}
              rowData={section.data}
              columnDefs={section.columns}
              defaultColDef={{
                flex: 1,
                minWidth: 100,
              }}
              autoGroupColumnDef={{
                headerName: "Profile Type",
                minWidth: 200,
                cellRendererParams: {
                  suppressCount: true,
                },
              }}
              groupDefaultExpanded={-1}
              context={{
                sectionTitle: section.title,
                handleDeleteRow: handleDeleteRow,
              }}
              onCellValueChanged={(event) => onCellValueChanged(event, section.title)}
              onGridReady={(event) => onGridReady(event)}
              domLayout="normal"
              pagination={section.data.length > 10}
              paginationPageSize={10}
              suppressCellFocus={false}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
