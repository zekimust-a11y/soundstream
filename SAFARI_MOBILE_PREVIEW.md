# Safari Mobile Preview for iPhone 15

## Method 1: Using Safari's Responsive Design Mode

1. Open Safari and navigate to `http://localhost:8081`
2. Press `Cmd+Option+I` to open Web Inspector
3. Click the **Responsive Design Mode** button (looks like two overlapping rectangles) in the toolbar
   - Or press `Cmd+Ctrl+R` as a shortcut
4. In the device dropdown at the top, you can:
   - Select "iPhone 15 Pro" or "iPhone 15 Pro Max" if available
   - Or create a custom device:
     - Click the device dropdown
     - Select "Edit Resizable Devices..."
     - Click the "+" button
     - Name: "iPhone 15"
     - Width: 393
     - Height: 852
     - User Agent: iPhone
     - Click "Save"

## Method 2: Using the Mobile Preview HTML

I've created a `mobile-preview.html` file that includes iPhone 15 dimensions. Just open that file in Safari and select "iPhone 15 / 15 Pro" from the dropdown.

## iPhone 15 Specifications:
- **iPhone 15 / 15 Pro**: 393 x 852 pixels
- **iPhone 15 Plus / 15 Pro Max**: 430 x 932 pixels

These are the actual viewport dimensions for Safari on iPhone 15 devices.


