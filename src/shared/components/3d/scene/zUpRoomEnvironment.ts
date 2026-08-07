import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** RoomEnvironment is authored Y-up; the editor's world and ground plane are Z-up. */
export function createZUpRoomEnvironment(): RoomEnvironment {
  const environment = new RoomEnvironment();
  environment.rotation.x = Math.PI / 2;
  environment.updateMatrixWorld(true);
  return environment;
}
