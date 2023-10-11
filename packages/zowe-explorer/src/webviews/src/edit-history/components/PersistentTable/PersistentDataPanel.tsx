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
import { VSCodePanelView, VSCodeDataGrid } from "@vscode/webview-ui-toolkit/react";
import { JSXInternal } from "preact/src/jsx";
import PersistentToolBar from "../PersistentToolBar/PersistentToolBar";
import PersistentTableData from "./PersistentTableData";
import PersistentDataGridHeaders from "./PersistentDataGridHeaders";
import PersistentVSCodeAPI from "../PersistentVSCodeAPI";
import { DataPanelContext, isSecureOrigin } from "../PersistentUtils";
import { panelId } from "../../types";

export default function PersistentDataPanel({ type }: { type: string }): JSXInternal.Element {
  const [data, setData] = useState<{ [type: string]: { [property: string]: string[] } }>({ ds: {}, uss: {}, jobs: {} });
  const [selection, setSelection] = useState<{ [type: string]: string }>({ [type]: "search" });
  const [persistentProp, setPersistentProp] = useState<string[]>([]);

  const handleChange = (newSelection: string) => {
    setSelection(() => ({ [type]: newSelection }));
    PersistentVSCodeAPI.getVSCodeAPI().postMessage({
      command: "update-selection",
      attrs: {
        selection: newSelection,
        type,
      },
    });
  };

  useEffect(() => {
    window.addEventListener("message", (event) => {
      if (!isSecureOrigin(event.origin)) {
        return;
      }

      setData(event.data);

      if ("selection" in event.data) {
        setSelection(() => ({
          [type]: event.data.selection[type],
        }));
      }
    });
  }, []);

  useEffect(() => {
    setPersistentProp(() => data[type][selection[type]]);
  }, [data]);

  useEffect(() => {
    setPersistentProp(() => data[type][selection[type]]);
  }, [selection]);

  return (
    <DataPanelContext.Provider value={{ type, selection }}>
      <VSCodePanelView id={panelId[type]} style={{ flexDirection: "column" }}>
        <PersistentToolBar handleChange={handleChange} />
        <VSCodeDataGrid>
          <PersistentDataGridHeaders />
          <PersistentTableData persistentProp={persistentProp} />
        </VSCodeDataGrid>
      </VSCodePanelView>
    </DataPanelContext.Provider>
  );
}
