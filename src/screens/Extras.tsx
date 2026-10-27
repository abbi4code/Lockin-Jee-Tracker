"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Piece } from "../components/chess/Piece";
import { Page } from "../components/Shell";
import { SketchGlyph } from "../components/skribbl/parts";
import { TankGlyph } from "../components/tanks/TankGlyph";
import { fadeUp, Label } from "../components/ui";

/** Hidden corner of the app (reached from the dot at the end of the nav bar): things for breaks. */
const EXTRAS = [
  { href: "/extras/chess", title: "chess", body: "Two players on one screen, the computer (easy, medium, hard), or a friend online with a link.", icon: <Piece type="n" color="w" className="size-9" /> },
  { href: "/extras/skribbl", title: "skribbl", body: "One draws, everyone guesses. Make a room, send the link to your friends.", icon: <SketchGlyph className="size-9" /> },
  { href: "/extras/tanks", title: "tanks", body: "Angle, power, wind, nine weapons. Blow up the ground and your friend. Against the computer, on one phone, or online.", icon: <TankGlyph className="size-9" /> },
];

export function ExtrasScreen() {
  return (
    <Page>
      <motion.header variants={fadeUp} className="pb-8">
        <Label>you found it</Label>
        <h1 className="dot mt-3 text-[40px] leading-none lg:text-[56px]">extras</h1>
        <p className="mt-4 max-w-md text-[16px] text-mute">Little things for a break. Take one, then get back to it.</p>
      </motion.header>
      <motion.section variants={fadeUp} className="border-t border-line lg:grid lg:grid-cols-2 lg:gap-x-14">
        {EXTRAS.map((x) => (
          <Link key={x.href} href={x.href} className="group flex items-center gap-5 border-b border-line py-6">
            {x.icon}
            <div className="min-w-0 flex-1">
              <div className="text-[20px] font-medium tracking-tight">{x.title}</div>
              <p className="mt-1 text-[14.5px] text-mute">{x.body}</p>
            </div>
            <ArrowRight className="size-4 text-dim transition group-hover:translate-x-0.5 group-hover:text-fg" />
          </Link>
        ))}
      </motion.section>
    </Page>
  );
}
