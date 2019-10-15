import { Color, project, setup, Layer } from "paper";

import Bubble from "./bubble";
import { uniqueIds } from "./uniqueId";

// Manages a collection of comic bubbles warpped around HTML elements that share a common parent.
// Each element that has a comic bubble has a data-bubble attribute specifying the appearance
// of the bubble. Comical can help with initializing this to add a bubble to an element.
// The data-bubble attributes contain a modified JSON representation of a BubbleSpec
// describing the bubble.
// Comical is designed to be the main class exported by Comical.js, and provides methods
// for setting things up (using a canvas overlayed on the common parent of the bubbles
// and paper.js shapes) so that the bubbles can be edited by dragging handles.
// It also supports drawing groups of bubbles in layers, with appropriate merging
// of bubbles at the same level.
// As the bubbles are edited using Comical handles, the data-bubble attributes are
// automatically updated. It's also possible to alter a data-bubble attribute using
// external code, and tell Comical to update things to match.
// Finally, Comical can replace a finished bubble canvas with a single SVG, resulting in
// a visually identical set of bubbles that can be rendered without using Canvas and
// Javascript.
export default class Comical {
  static backColor = new Color("white");

  static bubbleLists = new Map<Element, Bubble[]>();

  static allBubbles: Bubble[];

  static activeBubble: Bubble | undefined;

  static handleLayer: Layer;

  public static convertCanvasToSvgImg(parent: HTMLElement) {
    const canvas = parent.getElementsByTagName("canvas")[0];
    if (!canvas) {
      return;
    }
    // Remove drag handles
    project!
      .getItems({
        recursive: true,
        match: (x: any) => {
          return x.name && x.name.startsWith("handle");
        }
      })
      .forEach(x => x.remove());
    const svg = project!.exportSVG() as SVGElement;
    svg.classList.add("bubble-edit-generated");
    uniqueIds(svg);
    canvas.parentElement!.insertBefore(svg, canvas);
    canvas.remove();
    Comical.stopMonitoring(parent);
  }

  // This logic is designed to prevent accumulating mutation observers.
  // Not yet fully tested.
  private static stopMonitoring(parent: HTMLElement) {
    const bubbles = Comical.bubbleLists.get(parent);
    if (bubbles) {
      bubbles.forEach(bubble => bubble.stopMonitoring());
    }
  }

  // Make the bubble for the specified element (if any) active. This means
  // showing its edit handles. Must first call convertBubbleJsonToCanvas(),
  // passing the appropriate parent element.
  public static activateElement(contentElement: Element) {
    let newActiveBubble: Bubble | undefined = undefined;
    if (contentElement) {
      newActiveBubble = Comical.allBubbles.find(
        x => x.content === contentElement
      );
    }
    Comical.activateBubble(newActiveBubble);
  }

  // Make active (show handles) the specified bubble.
  public static activateBubble(newActiveBubble: Bubble | undefined) {
    if (newActiveBubble == Comical.activeBubble) {
      return;
    }
    Comical.hideHandles();
    Comical.activeBubble = newActiveBubble;
    if (Comical.activeBubble) {
      Comical.activeBubble.showHandles();
    }
  }

  public static hideHandles() {
    if (Comical.handleLayer) {
      Comical.handleLayer.removeChildren();
    }
  }

  // call after adding or deleting elements with data-bubble
  // assumes convertBubbleJsonToCanvas has been called and canvas exists
  public static update(parent: HTMLElement) {
    Comical.stopMonitoring(parent);
    while (project!.layers.length > 1) {
      const layer = project!.layers.pop();
      if (layer) {
        layer.remove(); // Erase this layer
      }
    }
    if (project!.layers.length > 0) {
      project!.layers[0].activate();
    }
    project!.activeLayer.removeChildren();

    const elements = parent.ownerDocument!.evaluate(
      ".//*[@data-bubble]",
      parent,
      null,
      XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    const bubbles: Bubble[] = [];
    Comical.bubbleLists.set(parent, bubbles);

    var zLevelList: number[] = [];
    Comical.allBubbles = [];
    for (let i = 0; i < elements.snapshotLength; i++) {
      const element = elements.snapshotItem(i) as HTMLElement;
      const bubble = new Bubble(element);
      Comical.allBubbles.push(bubble);

      let zLevel = bubble.getSpecLevel();
      if (!zLevel) {
        zLevel = 0;
      }
      zLevelList.push(zLevel);
    }

    // Ensure that they are in ascending order
    zLevelList.sort();

    // First we need to create all the layers in order. (Because they automatically get added to the end of the project's list of layers)
    // Precondition: Assumes zLevelList is sorted.
    const levelToLayer = {};
    for (let i = 0; i < zLevelList.length; ++i) {
      // Check if different than previous. (Ignore duplicate z-indices)
      if (i == 0 || zLevelList[i - 1] != zLevelList[i]) {
        const zLevel = zLevelList[i];
        var lowerLayer = new Layer();
        var upperLayer = new Layer();
        levelToLayer[zLevel] = [lowerLayer, upperLayer];
      }
    }
    Comical.handleLayer = new Layer();

    // Now that the layers are created, we can go back and place objects into the correct layers and ask them to draw themselves.
    for (let i = 0; i < Comical.allBubbles.length; ++i) {
      const bubble = Comical.allBubbles[i];

      let zLevel = bubble.getSpecLevel();
      if (!zLevel) {
        zLevel = 0;
      }

      const [lowerLayer, upperLayer] = levelToLayer[zLevel];
      bubble.setLayers(lowerLayer, upperLayer, Comical.handleLayer);
      bubble.makeShapes();
      bubbles.push(bubble);
    }
  }

  public static convertBubbleJsonToCanvas(parent: HTMLElement) {
    const canvas = parent.ownerDocument!.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.classList.add("bubble-edit-generated");
    const oldSvg = parent.getElementsByClassName("bubble-edit-generated")[0];
    if (oldSvg) {
      oldSvg.parentElement!.insertBefore(canvas, oldSvg);
      oldSvg.remove();
    } else {
      parent.insertBefore(canvas, parent.firstChild); // want to use prepend, not in FF45.
    }
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    setup(canvas);
    Comical.update(parent);
  }

  public static bubbleVersion = "1.0";
}

// planned next steps
// 1. When we wrap a shape around an element, record the shape as the data-bubble attr, a block of json as indicted in the design doc.
// Tricks will be needed if it is an arbitrary SVG.
// 2. Add function ConvertSvgToCanvas(parent). Does more or less the opposite of ConvertCanvasToSvg,
// but using the data-X attributes of children of parent that have them to initialize the canvas paper elements.
// Enhance test code to make Finish button toggle between Save and Edit.
// (Once the logic to create a canvas as an overlay on a parent is in place, can probably get all the paper.js
// stuff out of the test code.)