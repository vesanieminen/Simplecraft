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

export interface AvatarParts {
  group: THREE.Group;
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

  const skinMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: dark });
  const lightMat = new THREE.MeshLambertMaterial({ color: light });

  // torso: y 0.45..1.05
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.6, 0.32), lightMat);
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
  const leftLeg = mkLimb(0.19, 0.45, darkMat, -0.14, 0.45);
  const rightLeg = mkLimb(0.19, 0.45, darkMat, 0.14, 0.45);

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
