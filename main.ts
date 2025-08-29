import { App, Plugin, Modal, TFile, Setting } from 'obsidian';

interface ImageViewerSettings {
	showCopyButton: boolean;
	enableKeyboardShortcuts: boolean;
	zoomIncrement: number;
	syncModalSize: boolean;
}

const DEFAULT_SETTINGS: ImageViewerSettings = {
	showCopyButton: true,
	enableKeyboardShortcuts: true,
	zoomIncrement: 0.2,
	syncModalSize: true
}

class TextInputModal extends Modal {
	private text: string = '';
	private onSubmit: (text: string) => void;

	constructor(app: App, onSubmit: (text: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "텍스트 입력" });

		new Setting(contentEl)
			.setName("텍스트")
			.addText((text) =>
				text.onChange((value) => {
					this.text = value;
				})
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("추가")
					.setCta()
					.onClick(() => {
						this.close();
						this.onSubmit(this.text);
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("취소")
					.onClick(() => {
						this.close();
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export default class ImageViewerPlugin extends Plugin {
	settings: ImageViewerSettings;

	async onload() {
		await this.loadSettings();

		// Add mousedown event listener to main document
		this.registerDomEvent(document, 'mousedown', this.handleImageMouseDown.bind(this), true);
		
		// Handle existing popout windows that might already be open
		this.setupPopoutWindowListeners();
		
		// Also register for new popout windows
		this.registerEvent(
			this.app.workspace.on('window-open', (workspaceWindow, window) => {
				console.log('New popout window opened, registering image listener');
				// Register event listener for each popout window
				this.registerDomEvent(window.document, 'mousedown', this.handleImageMouseDown.bind(this), true);
			})
		);
	}

	onunload() {
		// Clean up event listeners
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	setupPopoutWindowListeners() {
		// Get all existing popout windows
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		leaves.forEach(leaf => {
			const view = leaf.view;
			if (view && (view as any).containerEl) {
				const containerEl = (view as any).containerEl;
				// Check if this is a popout window by looking at the window object
				const doc = containerEl.ownerDocument;
				if (doc && doc !== document) {
					console.log('Found existing popout window, registering image listener');
					this.registerDomEvent(doc, 'mousedown', this.handleImageMouseDown.bind(this), true);
				}
			}
		});
		
		// Also check for any other window objects that might exist
		if ((window as any).require) {
			const { remote } = (window as any).require('electron');
			if (remote) {
				const windows = remote.BrowserWindow.getAllWindows();
				windows.forEach((win: any) => {
					if (win.webContents && win !== remote.getCurrentWindow()) {
						// This is a different window, try to access its document
						try {
							const winDoc = win.webContents.document;
							if (winDoc) {
								console.log('Found electron window, registering image listener');
								this.registerDomEvent(winDoc, 'mousedown', this.handleImageMouseDown.bind(this), true);
							}
						} catch (e) {
							// Ignore security errors for cross-origin access
							console.log('Could not access window document:', e);
						}
					}
				});
			}
		}
	}

	handleImageMouseDown(event: MouseEvent) {
		const target = event.target as HTMLElement;
		
		// Check if clicked element is an image and not inside an existing modal or dialog
		if (target.tagName === 'IMG' && 
		    !target.closest('.image-viewer-modal') &&
		    !target.closest('.modal') &&
		    !target.closest('.modal-container') &&
		    !target.closest('.dialog') &&
		    !target.closest('.prompt') &&
		    !target.closest('.suggestion-container') &&
		    !target.closest('.menu') &&
		    !target.closest('.dropdown') &&
		    !target.closest('.popover') &&
		    !target.closest('.tooltip')) {
			
			// Only prevent default for content images, not UI elements
			const img = target as HTMLImageElement;
			
			// Additional check: only handle images that seem to be content images
			if (img.src && 
			    (img.src.startsWith('app://') || img.src.startsWith('file://') || img.src.startsWith('http')) &&
			    !img.src.includes('data:image/svg') &&
			    img.closest('.markdown-preview-view, .markdown-source-view, .view-content')) {
				
				event.preventDefault();
				event.stopPropagation();
				
				// Determine which window/document this event came from
				const sourceDocument = img.ownerDocument;
				const sourceWindow = sourceDocument.defaultView || window;
				
				console.log('Opening image viewer in window:', sourceWindow === window ? 'main' : 'popout');
				
				// Create modal in the correct app context but with awareness of source window
				const modal = new ImageViewerModal(this.app, img.src, this.settings, sourceDocument);
				modal.open();
			}
		}
	}
}

class ImageViewerModal extends Modal {
	private imageSrc: string;
	private sourceDocument: Document;
	private settings: ImageViewerSettings;
	private currentScale: number = 1;
	private currentRotation: number = 0;
	private imageElement: HTMLImageElement;
	private containerElement: HTMLElement;
	private isResizing: boolean = false;
	private isDragging: boolean = false;
	private originalImageWidth: number = 0;
	private originalImageHeight: number = 0;
	private controlsHeight: number = 50;
	private allImages: string[] = [];
	private currentImageIndex: number = 0;
	private imageOffsetX: number = 0;
	private imageOffsetY: number = 0;
	
	// Drawing-related properties
	private canvasElement: HTMLCanvasElement;
	private canvasContext: CanvasRenderingContext2D;
	private isDrawing: boolean = false;
	private currentMode: 'view' | 'draw' | 'text' | 'erase' = 'view';
	private drawingColor: string = '#ff0000';
	private drawingLineWidth: number = 3;
	private lastDrawPoint: { x: number, y: number } | null = null;
	private dragData: {
		startX: number;
		startY: number;
		startOffsetX: number;
		startOffsetY: number;
	} | null = null;
	private resizeData: {
		startX: number;
		startY: number;
		startWidth: number;
		startHeight: number;
		direction: string;
	} | null = null;

	constructor(app: App, imageSrc: string, settings: ImageViewerSettings, sourceDocument?: Document) {
		super(app);
		this.imageSrc = imageSrc;
		this.settings = settings;
		this.sourceDocument = sourceDocument || document;
		// Don't call findAllImages here - it's now async and will be called from onOpen
	}

	private async findAllImages() {
		console.log('=== FINDING ALL IMAGES (Obsidian API Method) ===');
		
		try {
			// Method 1: Parse markdown source for internal links
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				console.log('Active file found:', activeFile.name);
				
				// Read the markdown content
				const content = await this.app.vault.cachedRead(activeFile);
				console.log('File content length:', content.length);
				
				// Extract image links using regex: ![[image.ext]] or ![](image.ext)
				const imageRegex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|bmp|svg))\]\]|!\[.*?\]\(([^)]+\.(png|jpg|jpeg|gif|webp|bmp|svg))\)/gi;
				const matches = [...content.matchAll(imageRegex)];
				
				console.log('Found image links in markdown:', matches.length);
				
				const imageNames: string[] = [];
				matches.forEach((match, index) => {
					// match[1] is for ![[image.ext]] format, match[3] is for ![](image.ext) format
					const imageName = match[1] || match[3];
					console.log(`Image ${index}: ${imageName}`);
					imageNames.push(imageName);
				});
				
				// Method 2: Get all image files from vault
				const allFiles = this.app.vault.getFiles();
				const imageFiles = allFiles.filter(file => 
					/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(file.name)
				);
				
				console.log('Total image files in vault:', imageFiles.length);
				
				// Method 3: Match found names with actual files and generate URLs
				const foundImages: string[] = [];
				
				for (const imageName of imageNames) {
					// Find the actual file
					const imageFile = imageFiles.find(f => 
						f.name === imageName || 
						f.name.includes(imageName) ||
						imageName.includes(f.name)
					);
					
					if (imageFile) {
						// Generate proper Obsidian resource URL
						const resourcePath = this.app.vault.getResourcePath(imageFile);
						console.log(`Matched "${imageName}" -> ${resourcePath}`);
						foundImages.push(resourcePath);
					} else {
						console.log(`Could not find file for: ${imageName}`);
					}
				}
				
				// If we found images via markdown parsing, use those
				if (foundImages.length > 0) {
					this.allImages = foundImages;
					console.log('Using markdown-parsed images:', this.allImages.length);
				} else {
					// Fallback: use images from the same folder as current image
					console.log('Fallback: using folder-based approach');
					await this.findImagesByFolder(imageFiles);
				}
				
			} else {
				console.log('No active file found, using DOM-based approach');
				await this.findImagesByDOM();
			}
			
		} catch (error) {
			console.error('Error in findAllImages:', error);
			// Final fallback to DOM-based approach
			await this.findImagesByDOM();
		}
		
		// Find current image index
		this.currentImageIndex = this.allImages.findIndex(src => {
			// Compare by filename or full path
			const currentFilename = this.imageSrc.split('/').pop()?.split('?')[0];
			const srcFilename = src.split('/').pop()?.split('?')[0];
			return src === this.imageSrc || srcFilename === currentFilename;
		});
		
		if (this.currentImageIndex === -1) {
			console.log('Current image not found in list, adding to beginning');
			this.allImages.unshift(this.imageSrc);
			this.currentImageIndex = 0;
		}
		
		console.log('=== FINAL RESULTS ===');
		console.log('Final image array:', this.allImages);
		console.log('Current image index:', this.currentImageIndex);
		console.log('Total images:', this.allImages.length);
		console.log('Should enable navigation?', this.allImages.length > 1);
		console.log('===================');
	}

	private async findImagesByFolder(allImageFiles: any[]) {
		try {
			// Extract folder path from current image
			const currentPath = decodeURIComponent(this.imageSrc);
			const pathMatch = currentPath.match(/\/([^\/]+\.(png|jpg|jpeg|gif|webp|bmp|svg))/i);
			
			if (pathMatch) {
				const currentFilename = pathMatch[1];
				console.log('Current image filename:', currentFilename);
				
				// Find files in the same folder or with similar names
				const relatedImages = allImageFiles.filter(file => {
					// Check if it's in attachments folder or similar folder structure
					return file.path.includes('attachments') || 
					       file.path.includes('images') ||
					       file.path.includes('Pasted image'); // Common Obsidian pattern
				});
				
				console.log('Found related images:', relatedImages.length);
				
				// Generate resource paths
				this.allImages = relatedImages.map(file => 
					this.app.vault.getResourcePath(file)
				);
				
			} else {
				console.log('Could not extract filename from current image path');
				this.allImages = [this.imageSrc];
			}
		} catch (error) {
			console.error('Error in findImagesByFolder:', error);
			this.allImages = [this.imageSrc];
		}
	}

	private async findImagesByDOM() {
		console.log('Using DOM-based fallback approach');
		
		// Previous DOM-based logic as fallback
		const strategies = [
			{ name: 'Active markdown preview', fn: () => document.querySelector('.workspace-leaf.mod-active .markdown-preview-view') },
			{ name: 'Active source view', fn: () => document.querySelector('.workspace-leaf.mod-active .markdown-source-view') },
			{ name: 'Any markdown preview', fn: () => document.querySelector('.markdown-preview-view') },
		];
		
		let images: NodeListOf<HTMLImageElement> | null = null;
		let contentEl: Element | null = null;
		
		for (const strategy of strategies) {
			contentEl = strategy.fn();
			if (contentEl) {
				images = contentEl.querySelectorAll('img');
				console.log(`DOM Strategy "${strategy.name}" found ${images.length} images`);
				if (images.length > 0) break;
			}
		}
		
		if (images && images.length > 0) {
			this.allImages = Array.from(images)
				.map(img => {
					// Check multiple attributes for image source
					return img.getAttribute('src') || 
					       img.getAttribute('data-src') || 
					       img.getAttribute('data-path') ||
					       img.getAttribute('data-resource-path') ||
					       img.src;
				})
				.filter(src => {
					return src && 
					       !src.includes('data:image/svg') &&
					       (src.startsWith('app://') || src.startsWith('file://') || 
					        src.startsWith('http') || src.includes('.'));
				});
		} else {
			this.allImages = [this.imageSrc];
		}
		
		console.log('DOM-based images found:', this.allImages.length);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('image-viewer-modal');

		// Add body class to allow scrolling for large modals
		document.body.addClass('image-viewer-active');

		// Find all images first (now async)
		await this.findAllImages();

		// Create modal structure
		this.createModalContent();
		this.createResizeHandles();
		this.setupEventListeners();
		
		// Add click to close on modal background (outside image and controls)
		contentEl.addEventListener('click', (e) => {
			// Close only if clicking on the modal background, not on image or controls
			if (e.target === contentEl || e.target === this.containerElement) {
				this.close();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		
		// Remove body class
		document.body.removeClass('image-viewer-active');
	}

	private createModalContent() {
		const { contentEl } = this;

		// Create image container
		this.containerElement = contentEl.createDiv('image-viewer-container');
		
		// Create image element
		this.imageElement = this.containerElement.createEl('img', {
			cls: 'image-viewer-image'
		});
		this.imageElement.src = this.imageSrc;
		this.imageElement.alt = 'Viewing image';
		
		// Create canvas overlay for drawing
		this.canvasElement = this.containerElement.createEl('canvas', {
			cls: 'image-viewer-canvas'
		});
		this.canvasContext = this.canvasElement.getContext('2d')!;
		
		// Set up image load handler to get original dimensions
		this.imageElement.addEventListener('load', () => {
			this.originalImageWidth = this.imageElement.naturalWidth;
			this.originalImageHeight = this.imageElement.naturalHeight;
			
			// Set initial modal size to match image
			this.setInitialModalSize();
			
			// Sync canvas size with image
			this.syncCanvasWithImage();
		});

		// Create controls container
		const controlsContainer = contentEl.createDiv('image-viewer-controls-container');
		
		// Create drawing controls (top row)
		const drawingControls = controlsContainer.createDiv('image-viewer-controls drawing-controls');
		
		// Drawing control buttons (top row)
		const drawButton = drawingControls.createEl('button', {
			cls: 'image-viewer-control-btn draw-btn',
			title: 'Draw Mode (W)'
		});
		drawButton.setAttribute('data-shortcut', 'W');
		drawButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>`;
		drawButton.addEventListener('click', () => this.toggleDrawMode());
		
		const textButton = drawingControls.createEl('button', {
			cls: 'image-viewer-control-btn text-btn',
			title: 'Text Mode (T)'
		});
		textButton.setAttribute('data-shortcut', 'T');
		textButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4,7 4,4 20,4 20,7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`;
		textButton.addEventListener('click', () => this.toggleTextMode());
		
		const eraseButton = drawingControls.createEl('button', {
			cls: 'image-viewer-control-btn erase-btn',
			title: 'Eraser Mode (E)'
		});
		eraseButton.setAttribute('data-shortcut', 'E');
		eraseButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 20H7L3 16L7 12L17 2L22 7L12 17Z"></path><path d="M13 5L17 9"></path></svg>`;
		eraseButton.addEventListener('click', () => this.toggleEraseMode());
		
		const clearButton = drawingControls.createEl('button', {
			cls: 'image-viewer-control-btn clear-btn',
			title: 'Clear All Drawing (D)'
		});
		clearButton.setAttribute('data-shortcut', 'D');
		clearButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"></polyline><path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
		clearButton.addEventListener('click', () => this.clearDrawing());
		
		// Create main controls (bottom row)
		const controls = controlsContainer.createDiv('image-viewer-controls main-controls');
		
		// Copy button
		if (this.settings.showCopyButton) {
			const copyButton = controls.createEl('button', {
				cls: 'image-viewer-control-btn copy-btn',
				title: 'Copy Image (Cmd+C)'
			});
			copyButton.setAttribute('data-shortcut', '⌘C');
			copyButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`;
			copyButton.addEventListener('click', () => this.copyImage());
		}
		
		// Zoom buttons
		const zoomInBtn = controls.createEl('button', {
			cls: 'image-viewer-control-btn zoom-in-btn',
			title: 'Zoom In (+)'
		});
		zoomInBtn.setAttribute('data-shortcut', '+');
		zoomInBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35M11 8v6M8 11h6"></path></svg>`;
		zoomInBtn.addEventListener('click', () => this.zoomIn());
		
		const zoomOutBtn = controls.createEl('button', {
			cls: 'image-viewer-control-btn zoom-out-btn',
			title: 'Zoom Out (-)'
		});
		zoomOutBtn.setAttribute('data-shortcut', '-');
		zoomOutBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35M8 11h6"></path></svg>`;
		zoomOutBtn.addEventListener('click', () => this.zoomOut());
		
		// Rotation buttons
		const rotateLeftBtn = controls.createEl('button', {
			cls: 'image-viewer-control-btn rotate-left-btn',
			title: 'Rotate Left (← or Q)'
		});
		rotateLeftBtn.setAttribute('data-shortcut', '←');
		rotateLeftBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 2v6h6M2.66 15.57a10 10 0 1 0 .57-8.38"></path></svg>`;
		rotateLeftBtn.addEventListener('click', () => this.rotateLeft());
		
		const rotateRightBtn = controls.createEl('button', {
			cls: 'image-viewer-control-btn rotate-right-btn',
			title: 'Rotate Right (→ or E)'
		});
		rotateRightBtn.setAttribute('data-shortcut', '→');
		rotateRightBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38"></path></svg>`;
		rotateRightBtn.addEventListener('click', () => this.rotateRight());
		
		// Reset button
		const resetButton = controls.createEl('button', {
			cls: 'image-viewer-control-btn reset-btn',
			title: 'Reset View (R)'
		});
		resetButton.setAttribute('data-shortcut', 'R');
		resetButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4a9 9 0 0 1-14.85 4.36L3 14"></path></svg>`;
		resetButton.addEventListener('click', () => this.resetView());
		

		
		// Previous image button
		const prevButton = controls.createEl('button', {
			cls: 'image-viewer-control-btn prev-btn',
			title: 'Previous Image (↑)'
		});
		prevButton.setAttribute('data-shortcut', '↑');
		prevButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"></path></svg>`;
		prevButton.addEventListener('click', () => this.previousImage());
		
		// Next image button
		const nextButton = controls.createEl('button', {
			cls: 'image-viewer-control-btn next-btn',
			title: 'Next Image (↓)'
		});
		nextButton.setAttribute('data-shortcut', '↓');
		nextButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M19 12l-7 7-7-7"></path></svg>`;
		nextButton.addEventListener('click', () => this.nextImage());
		
		// Update button states - no timeout needed since findAllImages is already complete
		this.updateNavigationButtons(prevButton, nextButton);
		
		// Close button
		const closeButton = controls.createEl('button', {
			cls: 'image-viewer-control-btn close-btn',
			title: 'Close (Esc)'
		});
		closeButton.setAttribute('data-shortcut', 'ESC');
		closeButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
		closeButton.addEventListener('click', () => this.close());
		
		// Create drawing settings panel
		this.createDrawingSettings();
	}


	private createResizeHandles() {
		const { contentEl } = this;
		
		// Corner handles
		const corners = ['nw', 'ne', 'sw', 'se'];
		corners.forEach(corner => {
			const handle = contentEl.createDiv(`image-viewer-resize-handle corner-${corner}`);
			handle.addEventListener('mousedown', (e) => this.startResize(e, corner));
		});

		// Edge handles
		const edges = ['n', 'e', 's', 'w'];
		edges.forEach(edge => {
			const handle = contentEl.createDiv(`image-viewer-resize-handle edge-${edge}`);
			handle.addEventListener('mousedown', (e) => this.startResize(e, edge));
		});
	}

	private startResize(e: MouseEvent, direction: string) {
		e.preventDefault();
		e.stopPropagation();
		
		this.isResizing = true;
		const modalContent = this.contentEl;
		const rect = modalContent.getBoundingClientRect();
		
		this.resizeData = {
			startX: e.clientX,
			startY: e.clientY,
			startWidth: rect.width,
			startHeight: rect.height,
			direction: direction
		};

		// Use the source document for event listeners to handle popout windows correctly
		this.sourceDocument.addEventListener('mousemove', this.handleResize.bind(this));
		this.sourceDocument.addEventListener('mouseup', this.stopResize.bind(this));
		
		modalContent.style.userSelect = 'none';
	}

	private handleResize(e: MouseEvent) {
		if (!this.isResizing || !this.resizeData) return;
		
		const { startX, startY, startWidth, startHeight, direction } = this.resizeData;
		const deltaX = e.clientX - startX;
		const deltaY = e.clientY - startY;
		
		let newWidth = startWidth;
		let newHeight = startHeight;
		
		// Calculate new dimensions based on resize direction
		switch (direction) {
			case 'se':
				newWidth = startWidth + deltaX;
				newHeight = startHeight + deltaY;
				break;
			case 'sw':
				newWidth = startWidth - deltaX;
				newHeight = startHeight + deltaY;
				break;
			case 'ne':
				newWidth = startWidth + deltaX;
				newHeight = startHeight - deltaY;
				break;
			case 'nw':
				newWidth = startWidth - deltaX;
				newHeight = startHeight - deltaY;
				break;
			case 'e':
				newWidth = startWidth + deltaX;
				break;
			case 'w':
				newWidth = startWidth - deltaX;
				break;
			case 's':
				newHeight = startHeight + deltaY;
				break;
			case 'n':
				newHeight = startHeight - deltaY;
				break;
		}
		
		// Set minimum dimensions only
		newWidth = Math.max(200, newWidth);
		newHeight = Math.max(150, newHeight);
		
		// Remove viewport size limits to allow large modal sizes
		
		// Apply new dimensions to both modal content and container
		const modalContent = this.contentEl;
		const modalContainer = modalContent.parentElement;
		
		modalContent.style.width = newWidth + 'px';
		modalContent.style.height = newHeight + 'px';
		
		// Also update parent modal container
		if (modalContainer) {
			modalContainer.style.width = newWidth + 'px';
			modalContainer.style.height = newHeight + 'px';
		}
	}

	private stopResize() {
		this.isResizing = false;
		this.resizeData = null;
		
		// Remove event listeners from the correct document
		this.sourceDocument.removeEventListener('mousemove', this.handleResize.bind(this));
		this.sourceDocument.removeEventListener('mouseup', this.stopResize.bind(this));
		
		const modalContent = this.contentEl;
		modalContent.style.userSelect = '';
	}

	private setupEventListeners() {
		// Mouse wheel zoom
		this.containerElement.addEventListener('wheel', (e) => {
			e.preventDefault();
			if (e.deltaY < 0) {
				this.zoomIn();
			} else {
				this.zoomOut();
			}
		});

		// Image drag functionality
		this.imageElement.addEventListener('mousedown', (e) => {
			if (e.button === 0 && this.currentMode === 'view') { // Left mouse button and in view mode
				this.startDrag(e);
			}
		});
		
		// Setup drawing events
		this.setupDrawingEvents();

		// Keyboard shortcuts
		if (this.settings.enableKeyboardShortcuts) {
			this.scope.register(['Mod'], 'c', () => {
				this.copyImage();
			});
			
			this.scope.register([], 'Escape', () => {
				this.close();
			});
			
			// Zoom in shortcuts: + and =
			this.scope.register([], '+', () => {
				this.zoomIn();
			});
			
			this.scope.register([], '=', () => {
				this.zoomIn();
			});
			
			// Zoom out shortcuts: - and _
			this.scope.register([], '-', () => {
				this.zoomOut();
			});
			
			this.scope.register([], '_', () => {
				this.zoomOut();
			});
			
			// Arrow key shortcuts
			this.scope.register([], 'ArrowLeft', () => {
				this.rotateLeft();
			});
			
			this.scope.register([], 'ArrowRight', () => {
				this.rotateRight();
			});
			
			this.scope.register([], 'ArrowUp', () => {
				this.previousImage();
			});
			
			this.scope.register([], 'ArrowDown', () => {
				this.nextImage();
			});
			

			
			// Reset shortcuts: r and R
			this.scope.register([], 'r', () => {
				this.resetView();
			});
			
			this.scope.register([], 'R', () => {
				this.resetView();
			});
			
			// Drawing shortcuts
			this.scope.register([], 'w', () => {
				this.toggleDrawMode();
			});
			
			this.scope.register([], 't', () => {
				this.toggleTextMode();
			});
			
			this.scope.register([], 'e', () => {
				this.toggleEraseMode();
			});
			
			this.scope.register([], 'd', () => {
				this.clearDrawing();
			});
		}
	}

	private zoomIn() {
		this.currentScale += this.settings.zoomIncrement;
		this.updateImageScale();
	}

	private zoomOut() {
		this.currentScale = Math.max(0.1, this.currentScale - this.settings.zoomIncrement);
		this.updateImageScale();
	}

	private rotateLeft() {
		this.currentRotation -= 90;
		this.updateImageTransform();
	}

	private rotateRight() {
		this.currentRotation += 90;
		this.updateImageTransform();
	}

	private resetView() {
		this.currentRotation = 0;
		this.centerImageInViewport();
		this.setInitialModalSize(); // Use proper scaling logic instead of hardcoded scale = 1
	}

	private previousImage() {
		if (this.allImages.length <= 1) return;
		
		this.currentImageIndex = (this.currentImageIndex - 1 + this.allImages.length) % this.allImages.length;
		this.loadNewImage(this.allImages[this.currentImageIndex]);
	}

	private nextImage() {
		if (this.allImages.length <= 1) return;
		
		this.currentImageIndex = (this.currentImageIndex + 1) % this.allImages.length;
		this.loadNewImage(this.allImages[this.currentImageIndex]);
	}

	private loadNewImage(newSrc: string) {
		this.imageSrc = newSrc;
		this.imageElement.src = newSrc;
		
		// Reset transform and wait for image to load
		this.currentScale = 1;
		this.currentRotation = 0;
		this.centerImageInViewport();
		this.updateImageTransform();
		
		// Clear canvas when switching images
		this.clearDrawing();
		
		// Update original dimensions when new image loads
		this.imageElement.addEventListener('load', () => {
			this.originalImageWidth = this.imageElement.naturalWidth;
			this.originalImageHeight = this.imageElement.naturalHeight;
			this.setInitialModalSize(); // Use the scaling logic for new images too
		}, { once: true });
	}

	private startDrag(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		
		this.isDragging = true;
		this.dragData = {
			startX: e.clientX,
			startY: e.clientY,
			startOffsetX: this.imageOffsetX,
			startOffsetY: this.imageOffsetY
		};

		// Use the source document for event listeners to handle popout windows correctly
		this.sourceDocument.addEventListener('mousemove', this.handleDrag.bind(this));
		this.sourceDocument.addEventListener('mouseup', this.stopDrag.bind(this));
		
		this.imageElement.style.cursor = 'grabbing';
	}

	private handleDrag(e: MouseEvent) {
		if (!this.isDragging || !this.dragData) return;
		
		const deltaX = e.clientX - this.dragData.startX;
		const deltaY = e.clientY - this.dragData.startY;
		
		this.imageOffsetX = this.dragData.startOffsetX + deltaX;
		this.imageOffsetY = this.dragData.startOffsetY + deltaY;
		
		this.updateImageTransform();
	}

	private stopDrag() {
		this.isDragging = false;
		this.dragData = null;
		
		// Remove event listeners from the correct document
		this.sourceDocument.removeEventListener('mousemove', this.handleDrag.bind(this));
		this.sourceDocument.removeEventListener('mouseup', this.stopDrag.bind(this));
		
		this.imageElement.style.cursor = 'grab';
	}

	private updateImageScale() {
		this.updateImageTransform();
	}

	private updateImageTransform() {
		const transform = `translate(${this.imageOffsetX}px, ${this.imageOffsetY}px) scale(${this.currentScale}) rotate(${this.currentRotation}deg)`;
		this.imageElement.style.transform = transform;
		
		// Sync canvas with image transform
		setTimeout(() => this.syncCanvasWithImage(), 0);
	}

	private setInitialModalSize() {
		if (this.originalImageWidth === 0 || this.originalImageHeight === 0) return;
		
		// Calculate scale to fit image within viewport while maintaining aspect ratio
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight - this.controlsHeight; // Account for controls
		
		const scaleX = viewportWidth / this.originalImageWidth;
		const scaleY = viewportHeight / this.originalImageHeight;
		
		// Use the smaller scale to ensure the entire image fits
		const maxScale = Math.min(scaleX, scaleY);
		
		// Don't scale up small images, but scale down large ones
		this.currentScale = Math.min(1, maxScale);
		
		// Center image in viewport
		this.centerImageInViewport();
		
		this.updateImageTransform();
		this.setFullscreenModal();
	}

	private centerImageInViewport() {
		// Center image using CSS flexbox only, no manual offset needed
		this.imageOffsetX = 0;
		this.imageOffsetY = 0;
	}

	private setFullscreenModal() {
		// Set modal to fullscreen with transparent background
		const modalContent = this.contentEl;
		const modalContainer = modalContent.parentElement;
		
		// Force fullscreen dimensions
		modalContent.style.width = '100vw';
		modalContent.style.height = '100vh';
		modalContent.style.left = '0px';
		modalContent.style.top = '0px';
		modalContent.style.background = 'transparent';
		modalContent.style.border = 'none';
		modalContent.style.borderRadius = '0';
		modalContent.style.boxShadow = 'none';
		
		// Also set parent modal container
		if (modalContainer) {
			modalContainer.style.width = '100vw';
			modalContainer.style.height = '100vh';
			modalContainer.style.left = '0px';
			modalContainer.style.top = '0px';
			modalContainer.style.background = 'transparent';
			modalContainer.style.border = 'none';
			modalContainer.style.borderRadius = '0';
			modalContainer.style.boxShadow = 'none';
			modalContainer.style.maxWidth = 'none';
			modalContainer.style.maxHeight = 'none';
		}
	}

	// centerModal no longer needed - modal is always fullscreen


	private async copyImage() {
		try {
			// Convert image to blob
			const response = await fetch(this.imageSrc);
			const blob = await response.blob();
			
			// Copy to clipboard
			await navigator.clipboard.write([
				new ClipboardItem({
					[blob.type]: blob
				})
			]);
			
			// Show success message
			this.showNotice('Image copied to clipboard');
		} catch (error) {
			console.error('Failed to copy image:', error);
			this.showNotice('Failed to copy image');
		}
	}

	private showNotice(message: string) {
		// Create temporary notice element
		const notice = this.contentEl.createDiv('image-viewer-notice');
		notice.textContent = message;
		
		setTimeout(() => {
			notice.remove();
		}, 2000);
	}

	private updateNavigationButtons(prevButton: HTMLButtonElement, nextButton: HTMLButtonElement) {
		const hasMultipleImages = this.allImages.length > 1;
		
		console.log('Updating navigation buttons. Total images:', this.allImages.length);
		console.log('Has multiple images:', hasMultipleImages);
		console.log('All images:', this.allImages);
		
		if (hasMultipleImages) {
			prevButton.style.opacity = '1';
			prevButton.disabled = false;
			nextButton.style.opacity = '1';
			nextButton.disabled = false;
		} else {
			prevButton.style.opacity = '0.3';
			prevButton.disabled = true;
			nextButton.style.opacity = '0.3';
			nextButton.disabled = true;
		}
		
		console.log('Navigation buttons updated:', hasMultipleImages ? 'enabled' : 'disabled');
	}

	// Drawing-related methods
	private syncCanvasWithImage() {
		const imgRect = this.imageElement.getBoundingClientRect();
		const containerRect = this.containerElement.getBoundingClientRect();
		
		// Store canvas content before resizing
		const imageData = this.canvasContext.getImageData(0, 0, this.canvasElement.width, this.canvasElement.height);
		const oldWidth = this.canvasElement.width;
		const oldHeight = this.canvasElement.height;
		
		// Set canvas size to match the displayed image size
		this.canvasElement.width = imgRect.width;
		this.canvasElement.height = imgRect.height;
		this.canvasElement.style.width = imgRect.width + 'px';
		this.canvasElement.style.height = imgRect.height + 'px';
		
		// Restore canvas content if dimensions haven't changed significantly
		if (Math.abs(oldWidth - imgRect.width) < 5 && Math.abs(oldHeight - imgRect.height) < 5) {
			this.canvasContext.putImageData(imageData, 0, 0);
		}
		
		// Position canvas over the image
		this.canvasElement.style.position = 'absolute';
		this.canvasElement.style.left = (imgRect.left - containerRect.left) + 'px';
		this.canvasElement.style.top = (imgRect.top - containerRect.top) + 'px';
		this.canvasElement.style.pointerEvents = (this.currentMode === 'draw' || this.currentMode === 'erase') ? 'auto' : 'none';
	}

	private toggleDrawMode() {
		this.currentMode = this.currentMode === 'draw' ? 'view' : 'draw';
		this.updateModeUI();
		this.syncCanvasWithImage();
	}

	private toggleTextMode() {
		this.currentMode = this.currentMode === 'text' ? 'view' : 'text';
		this.updateModeUI();
		this.syncCanvasWithImage();
	}

	private toggleEraseMode() {
		console.log('toggleEraseMode called, current mode:', this.currentMode);
		this.currentMode = this.currentMode === 'erase' ? 'view' : 'erase';
		console.log('new mode:', this.currentMode);
		this.updateModeUI();
		this.syncCanvasWithImage();
	}

	private clearDrawing() {
		console.log('clearDrawing called');
		console.trace('clearDrawing call stack');
		this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
		this.showNotice('Drawing cleared');
	}

	private updateModeUI() {
		// Update button states
		const drawBtn = this.contentEl.querySelector('.draw-btn') as HTMLButtonElement;
		const textBtn = this.contentEl.querySelector('.text-btn') as HTMLButtonElement;
		const eraseBtn = this.contentEl.querySelector('.erase-btn') as HTMLButtonElement;
		
		// Reset all button states
		drawBtn?.classList.remove('active');
		textBtn?.classList.remove('active');
		eraseBtn?.classList.remove('active');
		
		// Reset container classes
		this.containerElement.classList.remove('draw-mode', 'text-mode', 'erase-mode');
		
		// Activate current mode button and add container class
		if (this.currentMode === 'draw') {
			drawBtn?.classList.add('active');
			this.containerElement.classList.add('draw-mode');
		} else if (this.currentMode === 'text') {
			textBtn?.classList.add('active');
			this.containerElement.classList.add('text-mode');
		} else if (this.currentMode === 'erase') {
			eraseBtn?.classList.add('active');
			this.containerElement.classList.add('erase-mode');
		}
		
		// Update canvas pointer events - allow draw, text, and erase modes
		this.canvasElement.style.pointerEvents = (this.currentMode === 'draw' || this.currentMode === 'text' || this.currentMode === 'erase') ? 'auto' : 'none';
	}

	private setupDrawingEvents() {
		// Canvas drawing events
		this.canvasElement.addEventListener('mousedown', (e) => {
			if (this.currentMode === 'draw') {
				this.startDrawing(e);
			} else if (this.currentMode === 'text') {
				this.addTextAtPosition(e);
			} else if (this.currentMode === 'erase') {
				this.startErasing(e);
			}
		});
		
		// Also add text event to container for better coverage
		this.containerElement.addEventListener('click', (e) => {
			console.log('Container clicked, mode:', this.currentMode, 'target:', e.target);
			if (this.currentMode === 'text' && (e.target === this.imageElement || e.target === this.canvasElement)) {
				console.log('Text mode click detected');
				this.addTextAtPosition(e);
			}
		});
		
		// Add mousedown event to container for erase mode
		this.containerElement.addEventListener('mousedown', (e) => {
			if (this.currentMode === 'erase' && (e.target === this.imageElement || e.target === this.canvasElement)) {
				console.log('Erase mode mousedown detected');
				this.startErasing(e);
			}
		});

		this.canvasElement.addEventListener('mousemove', (e) => {
			if (this.currentMode === 'draw' && this.isDrawing) {
				this.draw(e);
			} else if (this.currentMode === 'erase' && this.isDrawing) {
				this.erase(e);
			}
		});

		this.canvasElement.addEventListener('mouseup', () => {
			if (this.currentMode === 'draw' || this.currentMode === 'erase') {
				this.stopDrawing();
			}
		});

		this.canvasElement.addEventListener('mouseleave', () => {
			if (this.currentMode === 'draw' || this.currentMode === 'erase') {
				this.stopDrawing();
			}
		});
	}

	private startDrawing(e: MouseEvent) {
		this.isDrawing = true;
		const rect = this.canvasElement.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		
		this.lastDrawPoint = { x, y };
		
		this.canvasContext.beginPath();
		this.canvasContext.moveTo(x, y);
		this.canvasContext.lineCap = 'round';
		this.canvasContext.lineJoin = 'round';
		this.canvasContext.strokeStyle = this.drawingColor;
		this.canvasContext.lineWidth = this.drawingLineWidth;
	}

	private draw(e: MouseEvent) {
		if (!this.isDrawing || !this.lastDrawPoint) return;
		
		const rect = this.canvasElement.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		
		this.canvasContext.lineTo(x, y);
		this.canvasContext.stroke();
		
		this.lastDrawPoint = { x, y };
	}

	private stopDrawing() {
		this.isDrawing = false;
		this.lastDrawPoint = null;
		this.canvasContext.beginPath();
		
		// Reset composite operation back to normal
		this.canvasContext.globalCompositeOperation = 'source-over';
	}

	private addTextAtPosition(e: MouseEvent) {
		let rect, x, y;
		
		// Check if click is on canvas or image
		if (e.target === this.canvasElement) {
			rect = this.canvasElement.getBoundingClientRect();
			x = e.clientX - rect.left;
			y = e.clientY - rect.top;
		} else if (e.target === this.imageElement) {
			// Convert image coordinates to canvas coordinates
			const imgRect = this.imageElement.getBoundingClientRect();
			const canvasRect = this.canvasElement.getBoundingClientRect();
			x = e.clientX - canvasRect.left;
			y = e.clientY - canvasRect.top;
		} else {
			return; // Not on image or canvas
		}
		
		// Prevent default to avoid interference
		e.preventDefault();
		e.stopPropagation();
		
		// Create Obsidian text input modal
		const textModal = new TextInputModal(this.app, (text: string) => {
			if (text && text.trim()) {
				this.canvasContext.font = '16px Arial';
				this.canvasContext.fillStyle = this.drawingColor;
				this.canvasContext.fillText(text, x, y);
			}
		});
		textModal.open();
	}

	private startErasing(e: MouseEvent) {
		console.log('startErasing called');
		this.isDrawing = true;
		
		let x, y;
		// Check if click is on canvas or image
		if (e.target === this.canvasElement) {
			const rect = this.canvasElement.getBoundingClientRect();
			x = e.clientX - rect.left;
			y = e.clientY - rect.top;
		} else if (e.target === this.imageElement) {
			// Convert image coordinates to canvas coordinates
			const imgRect = this.imageElement.getBoundingClientRect();
			const canvasRect = this.canvasElement.getBoundingClientRect();
			x = e.clientX - canvasRect.left;
			y = e.clientY - canvasRect.top;
		} else {
			return;
		}
		
		this.lastDrawPoint = { x, y };
		
		// Set up eraser
		this.canvasContext.globalCompositeOperation = 'destination-out';
		this.canvasContext.beginPath();
		this.canvasContext.arc(x, y, this.drawingLineWidth * 2, 0, Math.PI * 2);
		this.canvasContext.fill();
		
		// Prevent default to avoid interference
		e.preventDefault();
		e.stopPropagation();
	}

	private erase(e: MouseEvent) {
		if (!this.isDrawing || !this.lastDrawPoint) return;
		
		const rect = this.canvasElement.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		
		// Erase along the path
		this.canvasContext.globalCompositeOperation = 'destination-out';
		this.canvasContext.beginPath();
		this.canvasContext.moveTo(this.lastDrawPoint.x, this.lastDrawPoint.y);
		this.canvasContext.lineTo(x, y);
		this.canvasContext.lineWidth = this.drawingLineWidth * 2;
		this.canvasContext.lineCap = 'round';
		this.canvasContext.stroke();
		
		this.lastDrawPoint = { x, y };
	}

	private createDrawingSettings() {
		const settingsPanel = this.contentEl.createDiv('drawing-settings-panel');
		
		// Color picker
		const colorGroup = settingsPanel.createDiv('setting-group');
		colorGroup.createEl('label', { text: 'Color:' });
		const colorPicker = colorGroup.createEl('input', {
			type: 'color',
			cls: 'color-picker'
		}) as HTMLInputElement;
		colorPicker.value = this.drawingColor;
		colorPicker.addEventListener('change', (e) => {
			this.drawingColor = (e.target as HTMLInputElement).value;
		});
		
		// Line width slider
		const widthGroup = settingsPanel.createDiv('setting-group');
		widthGroup.createEl('label', { text: 'Width:' });
		const widthSlider = widthGroup.createEl('input', {
			type: 'range',
			cls: 'width-slider'
		}) as HTMLInputElement;
		widthSlider.min = '1';
		widthSlider.max = '20';
		widthSlider.value = this.drawingLineWidth.toString();
		
		const widthValue = widthGroup.createEl('span', {
			cls: 'width-value',
			text: this.drawingLineWidth.toString()
		});
		
		widthSlider.addEventListener('input', (e) => {
			const value = parseInt((e.target as HTMLInputElement).value);
			this.drawingLineWidth = value;
			widthValue.textContent = value.toString();
		});
	}
}