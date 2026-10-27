import { Decks } from './decks'

const decks = new Decks((report) => window.halocline.player.report(report))
window.halocline.player.onCommand((command) => decks.handle(command))
