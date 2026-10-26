// Word lists for skribbl (/extras/skribbl). "general": everyday things anyone can draw. "jee": physics, chemistry
// and maths things from the syllabus that can still be drawn, so a break is a little bit of revision too.
// Lowercase; spaces are fine (the blanks keep them).

export type WordList = "general" | "jee" | "both";

// prettier-ignore
const GENERAL = [
  "apple", "banana", "mango", "grapes", "watermelon", "pineapple", "cherry", "strawberry", "coconut", "lemon",
  "carrot", "onion", "potato", "tomato", "corn", "mushroom", "chilli", "pizza", "burger", "sandwich",
  "samosa", "dosa", "noodles", "ice cream", "cake", "donut", "cookie", "popcorn", "egg", "bread",
  "cheese", "chocolate", "tea", "coffee", "milk", "juice", "lollipop", "cupcake", "pancake", "jalebi",
  "dog", "cat", "cow", "horse", "elephant", "tiger", "lion", "monkey", "giraffe", "zebra",
  "camel", "kangaroo", "panda", "penguin", "owl", "parrot", "peacock", "duck", "chicken", "eagle",
  "snake", "crocodile", "turtle", "frog", "fish", "shark", "whale", "dolphin", "octopus", "crab",
  "spider", "butterfly", "bee", "ant", "mosquito", "snail", "rabbit", "mouse", "squirrel", "bat",
  "dinosaur", "dragon", "unicorn", "ghost", "robot", "alien", "zombie", "vampire", "mermaid", "wizard",
  "house", "castle", "tent", "igloo", "bridge", "tower", "lighthouse", "windmill", "temple", "school",
  "hospital", "bank", "zoo", "stadium", "airport", "factory", "pyramid", "statue", "fountain", "well",
  "car", "bus", "truck", "bicycle", "motorcycle", "auto rickshaw", "train", "airplane", "helicopter", "boat",
  "ship", "submarine", "rocket", "tractor", "ambulance", "fire truck", "scooter", "skateboard", "hot air balloon", "taxi",
  "tree", "flower", "rose", "sunflower", "cactus", "leaf", "grass", "mountain", "volcano", "island",
  "beach", "river", "waterfall", "desert", "forest", "cave", "sun", "moon", "star", "cloud",
  "rain", "snow", "snowman", "lightning", "tornado", "rainbow", "wave", "fire", "smoke", "earth",
  "chair", "table", "bed", "sofa", "lamp", "fan", "door", "window", "clock", "mirror",
  "television", "laptop", "phone", "keyboard", "mouse pad", "headphones", "camera", "remote", "charger", "speaker",
  "book", "pencil", "pen", "eraser", "scissors", "backpack", "notebook", "glue", "stapler", "envelope",
  "key", "lock", "umbrella", "glasses", "watch", "ring", "crown", "hat", "cap", "shoe",
  "sock", "shirt", "jeans", "dress", "tie", "scarf", "gloves", "belt", "wallet", "purse",
  "toothbrush", "toothpaste", "soap", "towel", "comb", "bucket", "broom", "candle", "bottle", "cup",
  "plate", "spoon", "fork", "knife", "pan", "kettle", "fridge", "oven", "toaster", "mixer",
  "football", "cricket bat", "tennis", "basketball", "badminton", "chess", "kite", "balloon", "trophy", "medal",
  "guitar", "drum", "piano", "flute", "violin", "trumpet", "microphone", "tabla", "bell", "whistle",
  "doctor", "teacher", "police", "pilot", "chef", "farmer", "astronaut", "pirate", "king", "queen",
  "ninja", "superhero", "clown", "baby", "grandma", "soldier", "firefighter", "artist", "singer", "dancer",
  "eye", "nose", "ear", "mouth", "hand", "foot", "tooth", "heart", "brain", "skeleton",
  "beard", "mustache", "hair", "finger", "knee", "elbow", "tongue", "lips", "bone", "muscle",
  "birthday", "wedding", "diwali", "holi", "christmas", "fireworks", "gift", "party", "selfie", "picnic",
  "map", "compass", "anchor", "treasure", "sword", "shield", "bow and arrow", "cannon", "flag", "telescope",
  "ladder", "hammer", "saw", "nail", "screw", "rope", "chain", "wheel", "tyre", "bulb",
  "sleeping", "running", "swimming", "dancing", "crying", "laughing", "yawning", "sneezing", "fishing", "cooking",
  "traffic light", "zebra crossing", "petrol pump", "post box", "bench", "swing", "slide", "seesaw", "garden", "pond",
  "spaceship", "satellite", "planet", "comet", "astronaut helmet", "ufo", "meteor", "galaxy", "black hole", "moon landing",
];

// prettier-ignore
const JEE = [
  "pendulum", "spring", "pulley", "inclined plane", "lever", "projectile", "friction", "momentum", "collision", "torque",
  "gyroscope", "seesaw", "pressure gauge", "hydraulic lift", "siphon", "buoyancy", "submarine", "parachute", "rocket", "satellite",
  "orbit", "gravity", "free fall", "weightlessness", "escape velocity", "planet", "black hole", "tides", "centre of mass", "roller coaster",
  "magnet", "compass needle", "magnetic field", "electric field", "lightning rod", "battery", "resistor", "capacitor", "inductor", "transformer",
  "circuit", "bulb", "switch", "fuse", "ammeter", "voltmeter", "galvanometer", "generator", "electric motor", "solenoid",
  "lens", "prism", "rainbow", "mirror", "concave mirror", "convex lens", "periscope", "microscope", "telescope", "spectacles",
  "laser", "optical fibre", "shadow", "eclipse", "mirage", "total internal reflection", "interference", "diffraction", "polaroid", "kaleidoscope",
  "sound wave", "tuning fork", "echo", "sonar", "doppler effect", "standing wave", "guitar string", "organ pipe", "stethoscope", "loudspeaker",
  "thermometer", "barometer", "thermos flask", "steam engine", "refrigerator", "pressure cooker", "melting ice", "boiling water", "convection", "radiation",
  "atom", "electron", "proton", "neutron", "nucleus", "photon", "x ray", "radioactivity", "nuclear reactor", "solar panel",
  "semiconductor", "diode", "transistor", "logic gate", "led", "antenna", "radio", "wind turbine", "dam", "power plant",
  "beaker", "test tube", "conical flask", "burette", "pipette", "funnel", "bunsen burner", "litmus paper", "thermite", "distillation",
  "benzene", "methane", "water molecule", "carbon dioxide", "ozone", "diamond", "graphite", "buckyball", "salt crystal", "ice cube",
  "periodic table", "electrolysis", "battery cell", "rust", "flame test", "acid rain", "soap bubble", "detergent", "polymer", "rubber",
  "dna", "protein", "glucose", "nylon", "plastic bottle", "fertiliser", "fireworks", "glass", "cement", "smoke",
  "hydrogen balloon", "oxygen cylinder", "gas mask", "fire extinguisher", "lab coat", "safety goggles", "dropper", "magnifying glass", "weighing scale", "stopwatch",
  "graph", "parabola", "ellipse", "hyperbola", "circle", "triangle", "square root", "infinity", "pi", "integral",
  "derivative", "slope", "tangent", "vector", "matrix", "determinant", "dice", "coin toss", "probability", "venn diagram",
  "number line", "angle", "right angle", "protractor", "compass", "ruler", "set square", "calculator", "sine wave", "spiral",
  "cone", "cylinder", "sphere", "cube", "pyramid", "helix", "hexagon", "pentagon", "polygon", "staircase",
  "complex plane", "binomial", "factorial", "logarithm", "limit", "asymptote", "locus", "parallel lines", "perpendicular", "bisector",
];

export const WORDS: Record<Exclude<WordList, "both">, readonly string[]> = { general: GENERAL, jee: JEE };

/** The built-in words for a list choice, without repeats. */
export function builtIn(list: WordList): string[] {
  return list === "both" ? [...new Set([...GENERAL, ...JEE])] : [...WORDS[list]];
}
