/**
 * Cute blocky avatars — hand-built from boxes with a face, walking
 * animation and a soft blob shadow. All original art.
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

export interface AvatarParts {  group: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  ring: THREE.Mesh;
  shadow: THREE.Mesh;
}

export function createAvatar(colorHex: string): AvatarParts {
  const color = new THREE.Color(colorHex);
  const dark = color.clone().multiplyScalar(0.72);
  const light = color.clone().lerp(new THREE.Color(0xffffff), 0.35);

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // fabric, tinted per player: jumper, trousers and a soft head
  const skinMat = new THREE.MeshLambertMaterial({ color, map: getClothTexture() });
  const darkMat = new THREE.MeshLambertMaterial({ color: dark, map: getClothTexture() });
  const lightMat = new THREE.MeshLambertMaterial({ color: light, map: getClothTexture() });
  const denimMat = new THREE.MeshLambertMaterial({ color: dark, map: getDenimTexture() });
  const shirtMat = new THREE.MeshLambertMaterial({ color: light, map: getShirtTexture() });

  // torso: y 0.45..1.05 — BoxGeometry faces are +x -x +y -y +z -z, and +z is
  // the front, so that is the face that gets the collar/pocket/buttons
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.6, 0.32),
    [lightMat, lightMat, lightMat, lightMat, shirtMat, lightMat],
  );
  torso.position.y = 0.75;
  body.add(torso);

  // head: 1.05..1.55
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.46), skinMat);
  head.position.y = 1.3;
  body.add(head);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.44),
    new THREE.MeshBasicMaterial({ map: getFaceTexture(), transparent: true }),
  );
  face.position.set(0, 1.3, 0.235);
  body.add(face);

  // arms pivot at shoulders
  const mkLimb = (w: number, h: number, mat: THREE.Material, x: number, y: number): THREE.Object3D => {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    m.position.y = -h / 2;
    pivot.add(m);
    body.add(pivot);
    return pivot;
  };
  const leftArm = mkLimb(0.16, 0.5, darkMat, -0.34, 1.02);
  const rightArm = mkLimb(0.16, 0.5, darkMat, 0.34, 1.02);
  const leftLeg = mkLimb(0.19, 0.45, denimMat, -0.14, 0.45);
  const rightLeg = mkLimb(0.19, 0.45, denimMat, 0.14, 0.45);

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

  return { group, body, leftArm, rightArm, leftLeg, rightLeg, ring, shadow };
}

export function animateAvatar(parts: AvatarParts, walkPhase: number, moving: boolean, airborne: boolean, dt: number): void {
  const target = moving ? Math.sin(walkPhase) : Math.sin(walkPhase) * 0.15;
  const armA = airborne ? 1.1 : target * 0.85;
  const legA = airborne ? -0.5 : target * 0.9;
  const lerpK = 1 - Math.exp(-14 * dt);
  parts.leftArm.rotation.x += (armA - parts.leftArm.rotation.x) * lerpK;
  parts.rightArm.rotation.x += (-armA - parts.rightArm.rotation.x) * lerpK;
  parts.leftLeg.rotation.x += (legA - parts.leftLeg.rotation.x) * lerpK;
  parts.rightLeg.rotation.x += (-legA - parts.rightLeg.rotation.x) * lerpK;
  if (airborne) {
    parts.leftArm.rotation.z = -0.5;
    parts.rightArm.rotation.z = 0.5;
  } else {
    parts.leftArm.rotation.z = 0;
    parts.rightArm.rotation.z = 0;
  }
}
