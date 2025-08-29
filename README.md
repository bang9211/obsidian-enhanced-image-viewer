# Enhanced Image Viewer

An Obsidian plugin that provides an enhanced image viewing experience with zoom, copy functionality, and keyboard shortcuts.

## Features

- **Enhanced Image Modal**: Click any image to open it in a full-screen modal viewer
- **Zoom Controls**: Zoom in/out with mouse wheel or buttons
- **Copy to Clipboard**: Copy images directly to your clipboard
- **Keyboard Shortcuts**: Quick navigation and control with keyboard
- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Theme Support**: Adapts to Obsidian's light and dark themes

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings
2. Go to Community Plugins and turn off Safe Mode
3. Click Browse and search for "Enhanced Image Viewer"
4. Install and enable the plugin

### Manual Installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/obsidian-enhanced-image-viewer/` directory
3. Enable the plugin in Obsidian's Community Plugins settings

## Usage

### Opening Images
- Simply click on any image in your notes to open the enhanced viewer

### Zoom Controls
- **Mouse wheel**: Scroll up to zoom in, scroll down to zoom out
- **Zoom buttons**: Use the + and - buttons in the modal
- **Keyboard**: Press `+` to zoom in, `-` to zoom out, `0` to reset zoom

### Copy Images
- **Copy button**: Click the "Copy" button in the modal header
- **Keyboard shortcut**: Press `Ctrl/Cmd + C` to copy the image

### Navigation
- **Close modal**: Press `Escape` or click the × button
- All keyboard shortcuts work when the modal is active

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Escape` | Close image viewer |
| `Ctrl/Cmd + C` | Copy image to clipboard |
| `+` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom to 100% |

## Settings

The plugin provides several customizable settings:

- **Show Copy Button**: Toggle the copy button visibility
- **Enable Keyboard Shortcuts**: Enable/disable keyboard shortcuts
- **Zoom Increment**: Adjust the zoom step size (default: 0.2)

## Compatibility

- **Obsidian Version**: Requires Obsidian 0.15.0 or later
- **Platforms**: Works on desktop and mobile devices
- **File Types**: Supports all image formats supported by Obsidian (PNG, JPG, GIF, SVG, etc.)

## Development

### Building the Plugin

```bash
# Install dependencies
npm install

# Development build with watch mode
npm run dev

# Production build
npm run build
```

### Project Structure

```
obsidian-enhanced-image-viewer/
├── main.ts          # Main plugin code
├── styles.css       # Plugin styles
├── manifest.json    # Plugin manifest
├── package.json     # Node.js dependencies
└── README.md        # This file
```

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have suggestions for improvements, please:

1. Check the [Issues](https://github.com/bang9211/obsidian-enhanced-image-viewer/issues) page
2. Create a new issue if your problem isn't already reported
3. Provide detailed information about your setup and the issue

## Changelog

### Version 1.0.0
- Initial release
- Basic image modal viewer
- Zoom functionality with mouse wheel and buttons
- Copy to clipboard feature
- Keyboard shortcuts support
- Responsive design
- Theme compatibility

---

Made with ❤️ for the Obsidian community