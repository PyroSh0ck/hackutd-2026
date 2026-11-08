import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layouts/kit-layouts";
import { fixtureInitialView } from "@/contracts/game-fixtures";
import s from "@/features/game/game.module.css";

export default function HomePage() {
  return <main className={s.shell}>
    <PageHeader title="Cyber Sleuth" description="A little practice. A safer digital life." />
    <div className={s.hero}>
      <div data-asset-slot="garden-scene" className={s.art} role="img" aria-label="A garden waiting to grow">♧</div>
      <div className={s.stack}><p className={s.eyebrow}>ONE MESSAGE. YOUR NEXT MOVE.</p>
        <h1 className={s.title}>Keep your garden<br />fund growing.</h1>
        <p>{fixtureInitialView.scenario.premise}</p>
        <Link className={s.link} href="/play">Play the fixture preview →</Link>
        <p>Take your time. Look closer. Choose who to trust.</p>
      </div>
    </div>
    <Card title="A safe place to practice"><p>{fixtureInitialView.scenario.fictionalNotice}</p><p>This preview uses committed public snapshots. No live opponent or real money.</p><Link className={s.link} href="/play?adapter=api">Connect to the game API →</Link></Card>
  </main>;
}
