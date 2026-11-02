import './ui/styles.css';
import { Game } from './game';
import { VirtualPadSource } from './input/virtual';

async function boot(): Promise<void> {
  const game = new Game();
  await game.init();

  const w = window as unknown as {
    __lbw?: {
      game: Game;
      addVirtualPad: () => VirtualPadSource;
    };
  };
  // test/demo hook: virtual controllers drive the same input abstraction
  w.__lbw = {
    game,
    addVirtualPad: () => game.addVirtualPad('xbox'),
  };
}

void boot();
