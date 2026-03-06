# Zowe Config Editor

A webview-based editor for `zowe.config.json` files with editable AG Grid tables.

## Overview

The Config Editor provides a user-friendly interface to view and edit Zowe configuration files directly within VS Code. It automatically discovers `zowe.config.json` or `zowe.config.user.json` files in your workspace and presents the data in editable tables.

## Features

- **Automatic Config Discovery**: Finds and loads `zowe.config.json` or `zowe.config.user.json` from workspace root
- **Multiple Table Sections**: Organizes config data into logical sections:
  - **Profiles**: Edit profile configurations (type, properties)
  - **Defaults**: Modify default settings
  - **Other Settings**: Edit additional top-level properties
- **Inline Editing**: Click any cell to edit values directly in the grid
- **Auto-save**: Changes are automatically saved to the config file
- **VS Code Theme Integration**: Adapts to light/dark themes
- **Sortable & Filterable**: Built-in sorting and filtering for all columns

## Usage

### Opening the Config Editor

1. **Via Command Palette**:

   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type: `Zowe: Edit Config`
   - Press Enter

2. **Programmatically**:
   ```typescript
   import { ConfigEditor } from "./utils/ConfigEditor";
   ConfigEditor.display(context);
   ```

### Editing Configuration

1. **Edit a Cell**:

   - Click on any editable cell
   - Type the new value
   - Press Enter or click outside to save

2. **Profile Properties**:

   - Profile names are read-only
   - All other fields (type, host, port, etc.) are editable
   - New properties are automatically added to the profile's `properties` object

3. **Complex Values**:
   - For objects/arrays, enter valid JSON strings
   - Example: `{"key": "value"}` or `["item1", "item2"]`

### Data Structure

The editor processes the config file into three main sections:

#### Profiles Table

```json
{
  "profiles": {
    "lpar1": {
      "type": "zosmf",
      "properties": {
        "host": "example.com",
        "port": 443,
        "rejectUnauthorized": true
      }
    }
  }
}
```

Becomes a table with columns: `profileName`, `type`, `host`, `port`, `rejectUnauthorized`

#### Defaults Table

```json
{
  "defaults": {
    "zosmf": "lpar1",
    "base": "base_profile"
  }
}
```

Becomes a table with columns: `setting`, `value`

#### Other Settings Table

All other top-level properties (except `$schema`) are shown in a table with columns: `property`, `value`

## Architecture

### Frontend (Webview)

- **Location**: `packages/zowe-explorer/src/webviews/src/config-editor/`
- **Framework**: Preact (React-compatible)
- **Grid**: AG Grid Community Edition
- **Files**:
  - `index.html` - Entry point
  - `index.tsx` - Renders the app
  - `App.tsx` - Main component with grid logic
  - `style.css` - VS Code theme integration

### Backend (Extension)

- **Location**: `packages/zowe-explorer/src/utils/ConfigEditor.ts`
- **Extends**: `WebView` from `@zowe/zowe-explorer-api`
- **Responsibilities**:
  - Load config file from workspace
  - Send config data to webview
  - Handle update requests from webview
  - Write changes back to config file

### Message Flow

```
Extension (ConfigEditor.ts)
    ↓ (get-config-data)
Webview (App.tsx)
    ↓ (displays tables)
User edits cell
    ↓ (update-config-data)
Extension (ConfigEditor.ts)
    ↓ (writes to file)
Config file updated
```

## Development

### Building the Webview

```bash
cd packages/zowe-explorer/src/webviews
npm run build
```

### Adding New Features

1. **Add new table section**: Modify `processConfigData()` in `App.tsx`
2. **Add new message handler**: Update `onDidReceiveMessage()` in `ConfigEditor.ts`
3. **Customize grid behavior**: Modify AG Grid options in `App.tsx`

## Error Handling

- **No workspace**: Shows error if no workspace folder is open
- **No config file**: Shows error if `zowe.config.json` not found
- **Invalid JSON**: Parsing errors are logged and displayed
- **Write failures**: Update errors revert the cell value and show error message

## Limitations

- Only edits the first workspace folder's config
- Does not validate config schema
- Profile names cannot be changed (would require complex refactoring)
- No support for adding/removing profiles (only editing existing ones)

## Future Enhancements

- Add profile creation/deletion
- Schema validation
- Multi-workspace support
- Undo/redo functionality
- Import/export profiles
- Secure credential editing
