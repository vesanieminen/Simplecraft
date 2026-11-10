/**
 * Cute blocky avatars — hand-built from boxes with a face, walking
 * animation and a soft blob shadow. All original art.
 *
 * Costumes: the Kid is the classic knit jumper; the other models dress the
 * same skeleton (arms/legs/head stay where the animation expects them) and
 * keep one piece in the player's own colour, so Strawberry stays Strawberry
 * whatever the child picks.
 */

import * as THREE from 'three';

export interface AvatarColorDef {
  name: string;
  hex: string;
}

export const AVATAR_COLORS: AvatarColorDef[] = [
  { name: 'Strawberry', hex: '#ff6b6b' },
  { name: 'Banana', hex: '#ffd93d' },
  { name: 'Blueberry', hex: '#4d96ff' },
  { name: 'Bubblegum', hex: '#ff8ad4' },
  { name: 'Kiwi', hex: '#6bcb77' },
  { name: 'Grape', hex: '#a66bff' },
  { name: 'Tangerine', hex: '#ff9f45' },
  { name: 'Sky', hex: '#5cd6d0' },
];

export const NICKNAMES = ['Bunny', 'Tiger', 'Panda', 'Monkey', 'Koala', 'Fox', 'Penguin', 'Dino'];

export type ModelId = 'kid' | 'astronaut' | 'robot' | 'wizard' | 'dino' | 'cat' | 'knight';

export interface AvatarModelDef {
  id: ModelId;
  name: string;
  icon: string;
}

export const AVATAR_MODELS: AvatarModelDef[] = [
  { id: 'kid', name: 'Kid', icon: '🧒' },
  { id: 'astronaut', name: 'Astronaut', icon: '🚀' },
  { id: 'robot', name: 'Robot', icon: '🤖' },
  { id: 'wizard', name: 'Wizard', icon: '🧙' },
  { id: 'dino', name: 'Dino', icon: '🦖' },
  { id: 'cat', name: 'Cat', icon: '🐱' },
  { id: 'knight', name: 'Knight', icon: '🛡️' },
];

export function modelDef(id: ModelId): AvatarModelDef {
  return AVATAR_MODELS.find((m) => m.id === id) ?? AVATAR_MODELS[0];
}

export function nextModel(id: ModelId): ModelId {
  const i = AVATAR_MODELS.findIndex((m) => m.id === id);
  return AVATAR_MODELS[(i + 1) % AVATAR_MODELS.length].id;
}

let faceTexture: THREE.CanvasTexture | null = null;

function getFaceTexture(): THREE.CanvasTexture {
  if (faceTexture) return faceTexture;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  // eyes
  g.fillStyle = '#26303d';
  g.beginPath(); g.arc(20, 26, 5.5, 0, 7); g.fill();
  g.beginPath(); g.arc(44, 26, 5.5, 0, 7); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(21.8, 24.2, 1.8, 0, 7); g.fill();
  g.beginPath(); g.arc(45.8, 24.2, 1.8, 0, 7); g.fill();
  // cheeks
  g.fillStyle = 'rgba(255,130,150,0.55)';
  g.beginPath(); g.arc(12, 38, 4.5, 0, 7); g.fill();
  g.beginPath(); g.arc(52, 38, 4.5, 0, 7); g.fill();
  // smile
  g.strokeStyle = '#26303d';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath(); g.arc(32, 38, 11, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
  faceTexture = new THREE.CanvasTexture(c);
  faceTexture.magFilter = THREE.NearestFilter;
  return faceTexture;
}

/**
 * Cloth for the avatar. All of it is near-white weave and stitching, so the
 * per-player colour multiplies through: Strawberry stays Strawberry, it is
 * just knitted now.
 */
let clothTex: THREE.CanvasTexture | null = null;

function getClothTexture(): THREE.CanvasTexture {
  if (clothTex) return clothTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#e3e3e3';
  for (let x = 0; x < 32; x += 3) g.fillRect(x, 0, 1, 32); // warp
  g.fillStyle = '#f2f2f2';
  for (let y = 0; y < 32; y += 3) g.fillRect(0, y, 32, 1); // weft
  g.fillStyle = '#cfcfcf'; // little knit "v"s
  for (let y = 1; y < 32; y += 6) {
    for (let x = 1; x < 32; x += 6) {
      g.fillRect(x, y, 1, 2);
      g.fillRect(x + 1, y + 2, 1, 1);
      g.fillRect(x + 2, y, 1, 2);
    }
  }
  clothTex = new THREE.CanvasTexture(c);
  clothTex.magFilter = THREE.NearestFilter;
  clothTex.minFilter = THREE.NearestFilter;
  clothTex.generateMipmaps = false;
  clothTex.wrapS = clothTex.wrapT = THREE.RepeatWrapping;
  clothTex.repeat.set(2, 2);
  clothTex.colorSpace = THREE.NoColorSpace;
  return clothTex;
}

let denimTex: THREE.CanvasTexture | null = null;

/** denim for the trousers: diagonal twill and a seam down the leg */
function getDenimTexture(): THREE.CanvasTexture {
  if (denimTex) return denimTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 32, 32);
  g.strokeStyle = '#dedede';
  g.lineWidth = 1.5;
  for (let i = -32; i < 32; i += 4) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 32, 32);
    g.stroke();
  }
  g.fillStyle = '#c8c8c8';
  g.fillRect(15, 0, 2, 32); // seam
  g.fillStyle = '#f4f4f4';
  for (let y = 1; y < 32; y += 3) g.fillRect(14, y, 1, 1); // topstitching
  denimTex = new THREE.CanvasTexture(c);
  denimTex.magFilter = THREE.NearestFilter;
  denimTex.minFilter = THREE.NearestFilter;
  denimTex.generateMipmaps = false;
  denimTex.wrapS = denimTex.wrapT = THREE.RepeatWrapping;
  denimTex.repeat.set(2, 3);
  denimTex.colorSpace = THREE.NoColorSpace;
  return denimTex;
}

let shirtTex: THREE.CanvasTexture | null = null;

/** the front of the jumper: collar, a stitched pocket and two buttons */
function getShirtTexture(): THREE.CanvasTexture {
  if (shirtTex) return shirtTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e6e6e6';
  for (let x = 0; x < 64; x += 3) g.fillRect(x, 0, 1, 64);
  g.fillStyle = '#f2f2f2';
  for (let y = 0; y < 64; y += 3) g.fillRect(0, y, 64, 1);
  g.fillStyle = '#d6d6d6'; // collar band
  g.fillRect(0, 0, 64, 7);
  g.fillStyle = '#ffffff';
  g.fillRect(24, 0, 16, 9); // neck opening
  g.fillStyle = '#dedede'; // chest pocket…
  g.fillRect(12, 24, 20, 16);
  g.fillStyle = '#bdbdbd'; // …with stitching round it
  for (let x = 12; x <= 32; x += 4) { g.fillRect(x, 23, 2, 1); g.fillRect(x, 40, 2, 1); }
  for (let y = 24; y <= 40; y += 4) { g.fillRect(11, y, 1, 2); g.fillRect(32, y, 1, 2); }
  g.fillStyle = '#c4c4c4'; // two buttons
  g.beginPath(); g.arc(46, 26, 3, 0, 7); g.fill();
  g.beginPath(); g.arc(46, 42, 3, 0, 7); g.fill();
  g.fillStyle = '#ffffff';
  g.fillRect(45, 25, 2, 2);
  g.fillRect(45, 41, 2, 2);
  shirtTex = new THREE.CanvasTexture(c);
  shirtTex.magFilter = THREE.NearestFilter;
  shirtTex.minFilter = THREE.NearestFilter;
  shirtTex.generateMipmaps = false;
  shirtTex.colorSpace = THREE.NoColorSpace;
  return shirtTex;
}

export interface AvatarParts {
  group: THREE.Group;
  /** idle apart from the crouch, which tips it forward about the feet
   *  (`group.rotation` belongs to the swim lean, so the sneak lives here) */
  body: THREE.Group;
  /**
   * The upper body on its own pivot at hip height: torso, head, face, arms and
   * everything resting on them. In a crouch this sinks a little and folds a
   * little past the pelvis, while `body` tips the whole kid forward — the kid
   * sneaks instead of being squashed like a juice box.
   */
  chest: THREE.Group;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  /** wagging tail rig (dino and cat costumes only) */
  tail?: THREE.Object3D;
  ring: THREE.Mesh;
  shadow: THREE.Mesh;
  /** how deep into the crouch pose this body currently is (0 standing, 1 sneak) */
  crouchT: number;
}

/** hip height: the `chest` pivot sits here, so upper-body art keeps its usual y */
export const CROUCH_HIP = 0.5;
/**
 * The sneak, worked out for a rig with no knees. Three separate angles, because
 * a body and its legs tipped by the same amount is only a leaning plank:
 * `CROUCH_LEAN` tips the whole body about the FEET (the one thing that lowers
 * the hips), `CROUCH_LEGS` swings the legs further forward inside it so the
 * feet plant themselves out in front and the silhouette bends into a Z, and
 * `CROUCH_FOLD` hangs the torso forward over those thighs so the head drops
 * half a block. Arms and stride signs follow from the same rule: a limb
 * pointing DOWN swings BACKWARD for a positive x rotation, so "hanging down"
 * under a torso this far forward means swinging back by what it tipped.
 */
export const CROUCH_LEAN = 0.45;
/** the hunch: the torso hangs forward over the thighs */
export const CROUCH_FOLD = 0.45;
/** legs, inside the tipped body: negative swings the feet forward under the kid */
export const CROUCH_LEGS = -0.9;
/** what the hip pivot sinks inside the tipped body, on top of the drop the tip gives */
export const CROUCH_SINK = 0.06;
/** arms hang near vertical in the world, reaching a hair past it */
export const CROUCH_REACH = 0.15;
/** the sneak's shuffle: short opposite strides from the bent-leg stance */
export const CROUCH_STRIDE = 0.22;
export const CROUCH_SWING = 0.24;
/** the creep's weight: the body dips a hair on each stride's bottom */
export const CROUCH_BOB = 0.03;

/** small box helper for costume bits; parented so it rides the body/arm motion */
function costumeBox(
  parent: THREE.Object3D, w: number, h: number, d: number,
  x: number, y: number, z: number, mat: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function createAvatar(colorHex: string, model: ModelId = 'kid'): AvatarParts {
  const color = new THREE.Color(colorHex);
  const dark = color.clone().multiplyScalar(0.72);
  const light = color.clone().lerp(new THREE.Color(0xffffff), 0.35);

  const group = new THREE.Group();
  // yaw-then-pitch: the swim lean must rotate WITH the facing. With three's
  // default 'XYZ' order, rotation.x pitches about the WORLD x-axis, so the
  // face-down lean pointed one fixed direction no matter where the kid looked.
  group.rotation.order = 'YXZ';
  const body = new THREE.Group();
  group.add(body);

  // The upper body rides its own pivot at hip height, so a crouch can fold the
  // torso forward and let the hips sink while the legs keep working — and the
  // `upper` group inside it puts the origin back on the feet, so every piece of
  // art below keeps the absolute heights it has always had.
  const chest = new THREE.Group();
  chest.position.y = CROUCH_HIP;
  const upper = new THREE.Group();
  upper.position.y = -CROUCH_HIP;
  chest.add(upper);
  body.add(chest);

  // fabric, tinted per player: jumper, trousers and a soft head
  const skinMat = new THREE.MeshLambertMaterial({ color, map: getClothTexture() });
  const darkMat = new THREE.MeshLambertMaterial({ color: dark, map: getClothTexture() });
  const lightMat = new THREE.MeshLambertMaterial({ color: light, map: getClothTexture() });
  const denimMat = new THREE.MeshLambertMaterial({ color: dark, map: getDenimTexture() });
  const shirtMat = new THREE.MeshLambertMaterial({ color: light, map: getShirtTexture() });

  // costume palettes: near-white/steel/white weave lets the player's colour
  // survive anywhere we multiply it through (same trick as the knit jumper)
  const whiteCloth = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, map: getClothTexture() });
  const steelCloth = new THREE.MeshLambertMaterial({ color: 0xb9c4d2, map: getClothTexture() });
  const darkSteel = new THREE.MeshLambertMaterial({ color: 0x7f8b99, map: getClothTexture() });
  const inkMat = new THREE.MeshLambertMaterial({ color: 0x26303d });
  const goldMat = new THREE.MeshBasicMaterial({ color: 0xffc94d });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.3, depthWrite: false });

  // torso: y 0.45..1.05 — BoxGeometry faces are +x -x +y -y +z -z, and +z is
  // the front, so that is the face that gets the collar/pocket/buttons
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.6, 0.32),
    model === 'kid' ? [lightMat, lightMat, lightMat, lightMat, shirtMat, lightMat] : torsoMat(model),
  );
  torso.position.y = 0.75;
  upper.add(torso);

  function torsoMat(m: ModelId): THREE.Material | THREE.Material[] {
    if (m === 'astronaut') return whiteCloth;
    if (m === 'robot' || m === 'knight') return steelCloth;
    return [lightMat, lightMat, lightMat, lightMat, plainFront(m), lightMat];
  }
  function plainFront(m: ModelId): THREE.Material {
    // wizard/dino/cat keep a six-face torso but with plain knit front — the
    // costume silhouettes come from 3-D bits, not painted art
    void m;
    return lightMat;
  }

  // head: 1.05..1.55
  const headMat = model === 'robot' || model === 'knight' ? steelCloth : skinMat;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.46), headMat);
  head.position.y = 1.3;
  upper.add(head);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.44),
    new THREE.MeshBasicMaterial({ map: getFaceTexture(), transparent: true }),
  );
  face.position.set(0, 1.3, 0.235);
  upper.add(face);

  // arms pivot at shoulders (and ride the crouch fold), legs at the hips
  const mkLimb = (
    parent: THREE.Object3D, w: number, h: number, mat: THREE.Material, x: number, y: number,
  ): THREE.Object3D => {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    m.position.y = -h / 2;
    pivot.add(m);
    parent.add(pivot);
    return pivot;
  };
  const limbMat = model === 'astronaut' ? whiteCloth : model === 'robot' || model === 'knight' ? steelCloth : darkMat;
  const legMat = model === 'astronaut' ? whiteCloth : model === 'robot' || model === 'knight' ? darkSteel : denimMat;
  const leftArm = mkLimb(upper, 0.16, 0.5, limbMat, -0.34, 1.02);
  const rightArm = mkLimb(upper, 0.16, 0.5, limbMat, 0.34, 1.02);
  const leftLeg = mkLimb(body, 0.19, 0.45, legMat, -0.14, 0.45);
  const rightLeg = mkLimb(body, 0.19, 0.45, legMat, 0.14, 0.45);

  let tail: THREE.Object3D | undefined;

  // ---------------------------------------------------------------- costumes
  if (model === 'astronaut') {
    // bubble helmet: glass shell + gold trim, face showing through
    const helmet = costumeBox(upper, 0.66, 0.62, 0.6, 0, 1.32, 0, glassMat);
    void helmet;
    costumeBox(upper, 0.66, 0.08, 0.62, 0, 1.63, 0, goldMat); // brow band
    costumeBox(upper, 0.1, 0.5, 0.08, 0, 1.32, -0.33, goldMat); // back trim
    // backpack + a chest control panel in the player's own colour
    costumeBox(upper, 0.36, 0.44, 0.16, 0, 0.78, -0.27, whiteCloth);
    costumeBox(upper, 0.2, 0.14, 0.04, 0, 0.82, 0.18, new THREE.MeshLambertMaterial({ color }));
    costumeBox(upper, 0.05, 0.05, 0.02, -0.05, 0.82, 0.2, goldMat);
    costumeBox(upper, 0.05, 0.05, 0.02, 0.05, 0.82, 0.2, inkMat);
    // colour stripes on the wrists
    costumeBox(leftArm, 0.19, 0.08, 0.19, 0, -0.42, 0, new THREE.MeshLambertMaterial({ color }));
    costumeBox(rightArm, 0.19, 0.08, 0.19, 0, -0.42, 0, new THREE.MeshLambertMaterial({ color }));
  } else if (model === 'robot') {
    // antenna with a glowing colour tip + chest status light + ear bolts
    costumeBox(upper, 0.04, 0.24, 0.04, 0, 1.86, 0, darkSteel);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color }));
    tip.position.set(0, 2.02, 0);
    upper.add(tip);
    costumeBox(upper, 0.12, 0.08, 0.04, 0.14, 0.86, 0.18, new THREE.MeshBasicMaterial({ color }));
    costumeBox(upper, 0.06, 0.12, 0.06, -0.29, 1.34, 0, darkSteel); // ear bolts
    costumeBox(upper, 0.06, 0.12, 0.06, 0.29, 1.34, 0, darkSteel);
    costumeBox(upper, 0.3, 0.1, 0.2, 0, 1.62, 0, darkSteel); // head cap
    // chunky boots
    costumeBox(leftLeg, 0.24, 0.12, 0.26, 0, -0.42, 0.03, darkSteel);
    costumeBox(rightLeg, 0.24, 0.12, 0.26, 0, -0.42, 0.03, darkSteel);
  } else if (model === 'wizard') {
    // pointy colour hat with gold band, a white beard and a flaring robe
    costumeBox(upper, 0.46, 0.08, 0.44, 0, 1.58, 0, new THREE.MeshLambertMaterial({ color })); // brim
    costumeBox(upper, 0.3, 0.2, 0.3, 0, 1.72, 0, new THREE.MeshLambertMaterial({ color }));
    costumeBox(upper, 0.18, 0.2, 0.18, 0, 1.92, 0, new THREE.MeshLambertMaterial({ color: dark }));
    costumeBox(upper, 0.32, 0.07, 0.32, 0, 1.63, 0, goldMat); // band
    costumeBox(upper, 0.34, 0.24, 0.12, 0, 1.08, 0.24, whiteCloth); // beard
    costumeBox(upper, 0.08, 0.1, 0.02, -0.2, 1.2, 0.24, whiteCloth); // moustache tufts
    costumeBox(upper, 0.08, 0.1, 0.02, 0.2, 1.2, 0.24, whiteCloth);
    costumeBox(body, 0.68, 0.22, 0.46, 0, 0.42, 0, darkMat); // robe flare over the hips
  } else if (model === 'dino') {
    // snout, back spikes and a tail — the body itself wears the player's colour
    costumeBox(upper, 0.32, 0.2, 0.16, 0, 1.22, 0.31, skinMat);
    costumeBox(upper, 0.06, 0.05, 0.03, -0.07, 1.28, 0.39, inkMat); // nostrils
    costumeBox(upper, 0.06, 0.05, 0.03, 0.07, 1.28, 0.39, inkMat);
    costumeBox(upper, 0.1, 0.14, 0.1, 0, 1.12, 0.1, darkMat); // spine spikes
    costumeBox(upper, 0.09, 0.12, 0.09, 0, 1.1, -0.02, darkMat);
    costumeBox(upper, 0.08, 0.1, 0.08, 0, 1.08, -0.13, darkMat);
    tail = new THREE.Object3D();
    tail.position.set(0, 0.55, -0.2);
    body.add(tail);
    costumeBox(tail, 0.2, 0.2, 0.22, 0, 0, -0.1, skinMat);
    costumeBox(tail, 0.15, 0.15, 0.2, 0, 0.03, -0.3, skinMat);
    costumeBox(tail, 0.1, 0.1, 0.16, 0, 0.07, -0.46, darkMat);
  } else if (model === 'cat') {
    // ears, muzzle and a tail that wags while walking
    const earL = costumeBox(upper, 0.14, 0.14, 0.06, -0.18, 1.63, 0, new THREE.MeshLambertMaterial({ color }));
    const earR = costumeBox(upper, 0.14, 0.14, 0.06, 0.18, 1.63, 0, new THREE.MeshLambertMaterial({ color }));
    earL.rotation.z = 0.5;
    earR.rotation.z = -0.5;
    costumeBox(upper, 0.26, 0.14, 0.1, 0, 1.16, 0.27, whiteCloth); // muzzle
    costumeBox(upper, 0.06, 0.04, 0.03, 0, 1.22, 0.32, new THREE.MeshLambertMaterial({ color: 0xff9fb1 })); // nose
    costumeBox(upper, 0.05, 0.02, 0.02, -0.14, 1.24, 0.25, inkMat); // whisker nubs
    costumeBox(upper, 0.05, 0.02, 0.02, 0.14, 1.24, 0.25, inkMat);
    tail = new THREE.Object3D();
    tail.position.set(0, 0.5, -0.24);
    body.add(tail);
    costumeBox(tail, 0.1, 0.1, 0.24, 0, 0, -0.12, new THREE.MeshLambertMaterial({ color }));
    costumeBox(tail, 0.1, 0.18, 0.1, 0, 0.1, -0.3, new THREE.MeshLambertMaterial({ color }));
    costumeBox(tail, 0.1, 0.12, 0.1, 0, 0.24, -0.3, whiteCloth); // white tip
  } else if (model === 'knight') {
    // steel helm with a colour plume, breastplate with a colour crest, shield
    costumeBox(upper, 0.56, 0.34, 0.54, 0, 1.64, 0, steelCloth); // helm
    costumeBox(upper, 0.56, 0.05, 0.06, 0, 1.46, 0.27, inkMat); // visor slit
    costumeBox(upper, 0.1, 0.2, 0.34, 0, 1.9, 0, new THREE.MeshLambertMaterial({ color })); // plume
    costumeBox(upper, 0.54, 0.5, 0.08, 0, 0.78, 0.2, steelCloth); // breastplate
    costumeBox(upper, 0.2, 0.26, 0.03, 0, 0.78, 0.25, new THREE.MeshLambertMaterial({ color })); // crest
    const shield = costumeBox(leftArm, 0.34, 0.4, 0.06, -0.12, -0.34, 0.12, steelCloth);
    void shield;
    costumeBox(leftArm, 0.12, 0.14, 0.03, -0.12, -0.34, 0.16, new THREE.MeshLambertMaterial({ color })); // boss
    costumeBox(upper, 0.2, 0.08, 0.2, 0, 1.09, 0, darkSteel); // pauldron collar
  }

  // player ring (helps kids find themselves)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.045, 8, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.userData.noFade = true;
  group.add(ring);

  // blob shadow
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.userData.noFade = true;
  group.add(shadow);

  // Real sun shadows: every body part casts and catches, so a kid shades the
  // ground and the trees. The two decals under the feet stay out of the
  // shadow map — the blob below is their own fake contact shadow, and a thin
  // torus casting confetti is just noise.
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  ring.castShadow = false;
  ring.receiveShadow = false;
  shadow.castShadow = false;
  shadow.receiveShadow = false;

  return { group, body, chest, leftArm, rightArm, leftLeg, rightLeg, tail, ring, shadow, crouchT: 0 };
}

export function animateAvatar(
  parts: AvatarParts, walkPhase: number, moving: boolean, airborne: boolean, dt: number,
  crouching = false,
  swimming = false,
  climbing = false,
): void {
  const target = moving ? Math.sin(walkPhase) : Math.sin(walkPhase) * 0.15;
  let armA = airborne ? 1.1 : target * 0.85;
  let legA = airborne ? -0.5 : target * 0.9;

  // four limb targets: walking strides them in opposite pairs, swimming pulls
  // both arms together, and a sneak shuffles under a forward-tipped body
  let armL = armA, armR = -armA, legL = legA, legR = -legA;
  const folded = crouching && !airborne && !swimming && !climbing;
  // the whole-body channels the crouch owns (both are untouched otherwise):
  // `body` tips the kid forward over planted feet, and dips a hair per stride
  let bodyLean = 0, bodyDip = 0;
  if (swimming) {
    const s = Math.sin(walkPhase * 1.3);
    armA = -0.9 - s * 0.7; // reach forward, pull back under
    legA = 0.15 + Math.sin(walkPhase * 2.6) * 0.55; // flutter kick
    armL = armR = armA;
    legL = legR = legA;
  } else if (climbing) {
    // Hand over hand: the arms reach up in opposite pairs (a limb swings
    // FORWARD/up for a negative x rotation), and a knee lifts with the opposite
    // arm. The body stays upright — you climb a ladder facing it.
    const s = Math.sin(walkPhase);
    armL = -2.3 + s * 0.7;
    armR = -2.3 - s * 0.7;
    legL = -0.15 - s * 0.5;
    legR = -0.15 + s * 0.5;
  } else if (folded) {
    // How the big game sells a sneak, adapted to a rig with no knees: `body`
    // pivots at the feet, so tipping it forward plants the feet, lifts the
    // thighs in front of the kid and drops the hips with them. The torso
    // un-folds off the thighs so the face still reads, and the arms hang —
    // which, under a torso tipped this far, means swinging BACK: a limb
    // pointing down swings backward for a positive x rotation. (The old pose
    // got this backwards and swung the legs up while the torso nose-dived 57°,
    // which is how a crouch ended up looking like a handstand.)
    const k = parts.crouchT;
    const s = moving ? Math.sin(walkPhase) : Math.sin(walkPhase) * 0.15;
    legL = CROUCH_LEGS + s * CROUCH_STRIDE;
    legR = CROUCH_LEGS - s * CROUCH_STRIDE;
    const hang = -((CROUCH_LEAN + CROUCH_FOLD) * k - CROUCH_REACH);
    armL = hang - s * CROUCH_SWING;
    armR = hang + s * CROUCH_SWING;
    bodyLean = CROUCH_LEAN * k;
    bodyDip = -CROUCH_BOB * k * (moving ? (1 - Math.cos(walkPhase * 2)) * 0.5 : 0.5);
  }

  const lerpK = 1 - Math.exp(-14 * dt);
  parts.leftArm.rotation.x += (armL - parts.leftArm.rotation.x) * lerpK;
  parts.rightArm.rotation.x += (armR - parts.rightArm.rotation.x) * lerpK;
  parts.leftLeg.rotation.x += (legL - parts.leftLeg.rotation.x) * lerpK;
  parts.rightLeg.rotation.x += (legR - parts.rightLeg.rotation.x) * lerpK;
  // z-roll of the arms: flung out while falling, tucked in for the breaststroke,
  // braced a touch out to the sides when sneaking (same sign convention as the
  // fall) — enough to read as balance, not enough to look like a scarecrow
  const elbowZ = airborne ? -0.5 : swimming ? 0.35 : folded ? -0.12 : climbing ? 0.12 : 0;
  parts.leftArm.rotation.z = elbowZ;
  parts.rightArm.rotation.z = -elbowZ;

  // The crouch itself, and all of it pose: the kid tips forward over their
  // feet, the hips sink and the torso folds a little past the pelvis. Nothing
  // is scaled, so the head stays a head and the name ring under the kid stays
  // round.
  const crouchTo = folded ? 1 : 0;
  parts.crouchT += (crouchTo - parts.crouchT) * (1 - Math.exp(-9 * dt));
  const k = parts.crouchT;
  parts.body.rotation.x = bodyLean;
  parts.body.position.y = bodyDip;
  parts.chest.position.y = CROUCH_HIP - CROUCH_SINK * k;
  parts.chest.rotation.x = CROUCH_FOLD * k;

  if (parts.tail) parts.tail.rotation.y = Math.sin(walkPhase * 0.55 + 1.3) * 0.3; // costume tails always wag a little
}
