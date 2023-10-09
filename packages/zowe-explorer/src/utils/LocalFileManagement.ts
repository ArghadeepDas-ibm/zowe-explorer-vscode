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

import * as vscode from "vscode";
import * as globals from "../globals";
import * as os from "os";
import { IZoweDatasetTreeNode, IZoweTreeNode, IZoweUSSTreeNode, imperative } from "@zowe/zowe-explorer-api";
import { markDocumentUnsaved } from "./workspace";
import { isTypeUssTreeNode } from "../shared/context";
import { ZoweExplorerApiRegister } from "../ZoweExplorerApiRegister";
import { ZoweLogger } from "./LoggerUtils";
import * as nls from "vscode-nls";
import { isZoweDatasetTreeNode, isZoweUSSTreeNode, localFileInfo } from "../shared/utils";
import { downloadPs } from "../dataset/actions";
import { downloadUnixFile } from "../uss/actions";

// Set up localization
nls.config({
    messageFormat: nls.MessageFormat.bundle,
    bundleFormat: nls.BundleFormat.standalone,
})();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export class LocalFileManagement {
    public static getDefaultUri(): vscode.Uri {
        return vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir());
    }
    /**
     * Function that triggers compare of the old and new document in the active editor
     * @param {vscode.TextDocument} doc - document to update and compare with previous content
     * @param {IZoweDatasetTreeNode | IZoweUSSTreeNode} node - IZoweTreeNode
     * @param {string} label - {optional} used by IZoweDatasetTreeNode to getContents of file
     * @param {boolean} binary - {optional} used by IZoweUSSTreeNode to getContents of file
     * @param {imperative.IProfileLoaded} profile - {optional}
     * @returns {Promise<void>}
     */
    public static async compareSavedFileContent(
        doc: vscode.TextDocument,
        node: IZoweDatasetTreeNode | IZoweUSSTreeNode,
        label?: string,
        binary?: boolean,
        profile?: imperative.IProfileLoaded
    ): Promise<void> {
        await markDocumentUnsaved(doc);
        const prof = node ? node.getProfile() : profile;
        let downloadResponse;

        if (isTypeUssTreeNode(node)) {
            downloadResponse = await ZoweExplorerApiRegister.getUssApi(prof).getContents(node.fullPath, {
                file: node.getUSSDocumentFilePath(),
                binary,
                returnEtag: true,
                encoding: prof.profile?.encoding,
                responseTimeout: prof.profile?.responseTimeout,
            });
        } else {
            downloadResponse = await ZoweExplorerApiRegister.getMvsApi(prof).getContents(label, {
                file: doc.fileName,
                returnEtag: true,
                encoding: prof.profile?.encoding,
                responseTimeout: prof.profile?.responseTimeout,
            });
        }
        ZoweLogger.warn(localize("saveFile.etagMismatch.log.warning", "Remote file has changed. Presenting with way to resolve file."));
        vscode.commands.executeCommand("workbench.files.action.compareWithSaved");
        // re-assign etag, so that it can be used with subsequent requests
        const downloadEtag = downloadResponse?.apiResponse?.etag;
        if (node && downloadEtag !== node.getEtag()) {
            node.setEtag(downloadEtag);
        }
    }

    /**
     * Function that triggers compare of the 2 files selected for compare in the active editor
     * @returns {Promise<void>}
     */
    public static async compareChosenFileContent(): Promise<void> {
        const docUriArray: vscode.Uri[] = [];
        for (const node of globals.filesToCompare) {
            const fileInfo = await this.getCompareFilePaths(node);
            if (fileInfo.path) {
                docUriArray.push(vscode.Uri.file(fileInfo.path));
            } else {
                return;
            }
        }
        globals.resetCompareChoices();
        if (docUriArray.length === 2) {
            vscode.commands.executeCommand("vscode.diff", docUriArray[0], docUriArray[1]);
        }
    }

    private static async getCompareFilePaths(node: IZoweTreeNode): Promise<localFileInfo> {
        ZoweLogger.info(`Getting files ${String(globals.filesToCompare[0].label)} and ${String(globals.filesToCompare[1].label)} for comparison.`);
        let fileInfo = {} as localFileInfo;
        switch (true) {
            case isZoweDatasetTreeNode(node): {
                fileInfo = await downloadPs(node);
                break;
            }
            case isZoweUSSTreeNode(node): {
                fileInfo = await downloadUnixFile(node, true);
                break;
            }
            default: {
                ZoweLogger.warn(localize("getCompareFilePaths.treeNodeCheck.fail", "Something went wrong with compare of files."));
            }
        }
        return fileInfo;
    }
}
