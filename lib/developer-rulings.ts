// Developer responses transcribed from "(PUBLIC) Ruling Questions for Justin Gary and Gary Arant.pdf".
// The original exchange is preserved in transcript; only the card previews are editorial summaries.
export type RulingRecord = {
  number: number;
  slug: string;
  title: string;
  category: string;
  preview: string;
  transcript: string;
  mentionedCards: string[];
};

export const RULING_CATEGORIES = [
  "Card Identity, Deckbuilding & Errata",
  "Baku-Gear & BakuCores",
  "Brawls, Damage & Rerolls",
  "Timing, Batch & Effect Resolution",
  "Flip, Reveal & Discard Interactions",
  "Evolutions, Heroes & Character Abilities",
  "Geogan & Nanogan"
] as const;

export const DEVELOPER_RULINGS: RulingRecord[] = [
  {
    "number": 1,
    "slug": "q1",
    "title": "Dragonoid Maximus — required Heroes",
    "category": "Card Identity, Deckbuilding & Errata",
    "preview": "Dragonoid Maximus wins the game only if you control Hero cards named Dan Kouzo, Wynton Styles and Lia Venegas. Other Heroes featuring those characters do not satisfy the condition.",
    "transcript": "1.) How does Dragonoid Maximus and its listed heroes work compared to Bakugan who ask for specific\nheroes? (Pyrus Titan Dragonoid/ Ventus Titan Trox Ultra/ Darkus Maximus Nillious Ultra)\n\nDev Response: The victory condition of Dragonoid Maximus looks for three different Hero cards - One that is\nDan (any will do), one that is Lia (again, any Lia), and one that is Winton. In the case of Dan and Lia, it can meet\nthe condition for one of them.\n\n1 Follow Up: The Maximus rulings have differed between Justin Gary and Gary Arant since the reveals of Armored\nElite in November of 2019: Is this the final ruling that both the lead designers have agreed on?\n- Are we able to play any hero of the required characters to meet the win condition, when it was previously\nstated that only full names of characters would work? (Dan Kouzo from BB,BR,AA | Wynton Styles from BB | Lia\nVenegas from BB)\n\nDev Response: Gary here - I checked with Justin and he reminded me that we had made the full name ruling and added\nthe errata to the comp rules. My apologies for being mistaken here, Justin’s ruling is correct.",
    "mentionedCards": [
      "Maximus Dragonoid",
      "Dan Kouzo",
      "Wynton Styles",
      "Lia Venegas",
      "Pyrus Titan Dragonoid",
      "Ventus Titan Trox Ultra",
      "Darkus Maximus Nillious Ultra"
    ]
  },
  {
    "number": 2,
    "slug": "q2",
    "title": "Reduced costs still count as printed costs",
    "category": "Baku-Gear & BakuCores",
    "preview": "A card’s printed Energy Cost remains the same when its cost is reduced, including when other effects check the printed cost of Baku-Gear.",
    "transcript": "2.) How do cards that get their cost reduced (Everett Ray/ Philomena Dusk/Ventusdestruction) work\nalongside cards like Tusk Guard/ Haos Suplex/ Ventus Hyper Lupitheon Ultra?\n2a.) We are aware that cards that become free with a cost 5+ (Ventus Maximus Dragonoid/ Pyrus\nDiamond Kelion Ultra) set off cards like Tusk Guard and the other two, but how do cost reducers rule?\n\nDev Response: Cost reducers have a condition that they can cost less to play for various reasons.\nThey still count as a card with the cost that is listed in their energy cost.\n\n2b.) (Also going to ask how this works in respect to Bakugear that cost 5 or more, when played on a\ngear-reducing core, although I believed this was answered already?)\n\nDev Response: Same answer as above",
    "mentionedCards": [
      "Everett Ray",
      "Philomena Dusk",
      "Ventusdestruction",
      "Tusk Guard",
      "Haos Suplex",
      "Ventus Hyper Lupitheon Ultra",
      "Ventus Maximus Dragonoid",
      "Pyrus Diamond Kelion Ultra"
    ]
  },
  {
    "number": 3,
    "slug": "q3",
    "title": "Gear-reducing BakuCores affect the next Gear",
    "category": "Baku-Gear & BakuCores",
    "preview": "A Gear-reduction BakuCore reduces the cost of only the next Baku-Gear played onto its Bakugan. Reductions from multiple Cores picked up simultaneously combine.",
    "transcript": "3.) What are the concrete rules for gear-reducing cores? Main concerns being:\n3a.) When Bakugan A picks up a gear-reducing core, does this reduction count for as many gears as\nI can play from my hand that turn or only the first gear card I play?\n\nDev Response: Yes, as long as a Bakugan is holding a cost reduction core, you can play gear on that\nBakugan with the discount applied.\n\nDev Response Update: My response here was inaccurate. The intention of cost reduction for\nBaku-Gear from these Baku-Cores is that they apply only to the next Gear that would be played onto\nthat Bakugan.\n\nHere is our comp rule copy as it currently stands (apologies for weird formatting)…\n\nBakuCore cost reduction effects:\n-Some BakuCores grant the Bakugan they are attached to a cost reduction to the next\nBakuGear card played on that Bakugan.\n-This cost reduction is applied only to the next Baku-Gear card\nplayed on that Bakugan\n\n-This cost reduction only applies to Baku-Gear that are played\nonto the Bakugan that picked up the cost reduction BakuCore\n\n-Multiple cost reduction Cores that are picked up\nsimultaneously add their cost reduction together\n\nFor example - If a Bakugan picks up a Core that reduces\nGear cost by 2 Energy and another that reduces Gear cost by 1,\nthe next BakuGear card played on that Bakugan will have its cost\nreduced by 3 Energy.\n\nMy apologies for any confusion caused.\n\n3b.) When I rolled Bakugan B this turn with a reduction core, and Bakugan A is open without a\nreduction core, how much does one pay to play a gear onto Bakugan A?\n\nDev Response: The cost reduction on cores only applies to a Bakugan holding that core. Think of it\nas a BP bonus - a Bakugan that is holding a +650 MagicShield doesn’t apply that BP bonus to your\nother Bakugan.\n\n3c.) When I rolled Bakugan C this turn without a reduction core, and Bakugan B is open with a\nreduction core, how much does one pay to play a gear onto Bakugan B?\n\nDev Response: Gear played on a Bakugan with a reduction core has reduced cost - regardless of\nwho the active Bakugan is.",
    "mentionedCards": []
  },
  {
    "number": 4,
    "slug": "q4",
    "title": "Choosing which Baku-Gear to keep",
    "category": "Baku-Gear & BakuCores",
    "preview": "When a second Baku-Gear is attached, you choose which Gear to keep. The discarded Gear can still generate its “when you play this” effect.",
    "transcript": "4.) When one plays bakugear B onto a Bakugan with bakugear A already on it, one of the gears is discarded.\n4a.) Am I able to discard either A or B, or does A go into the discard pile?\ni.) If one is able to discard bakugear B instead of A, what happens when bakugear B has a\n\"when you play this\" effect? Will I get the effect and then the gear gets discarded?\n\nDev Response: Yes, you have to choose one to keep. This means that a gear with a played trigger\nwill enter play and give its bonus, even if it is discarded.",
    "mentionedCards": []
  },
  {
    "number": 6,
    "slug": "q6",
    "title": "Epic Character Card abilities",
    "category": "Card Identity, Deckbuilding & Errata",
    "preview": "A Bakugan receives Epic Character Card abilities only when its actual Epic Character Card is in play.",
    "transcript": "6.) Epic Character Cards release in Fusion Force and provide bakugan with additional effect text.\n6a.) Will someone be able to play a regular character card and get its ECC counterpart effects? Or\ndoes one need to have the ECC in their possession and in play in order to use the effect text?\n\nDev Response: You have to have the ECC to use that version of the card.",
    "mentionedCards": []
  },
  {
    "number": 7,
    "slug": "q7",
    "title": "Ninja Gear used after victory",
    "category": "Brawls, Damage & Rerolls",
    "preview": "Closing your victorious Bakugan with Ninja Gear during the Victor Step makes its Damage Rating effectively 0 for the attack.",
    "transcript": "7.) How does ninja gear interact with a bakugan during victor step? My bakugan has already won, but I am\ndeciding to close it.\n7a.) Does damage get dealt to my opponent just based on my bakugan's character card and any\ncore bonuses it had before retraction get removed?\n\nDev Response: You will effectively have a Damage Rating of 0 for dealing damage. The game will go\non as normal after that.",
    "mentionedCards": [
      "Ninja Gear"
    ]
  },
  {
    "number": 8,
    "slug": "q8",
    "title": "Haos Titan Pandoxx and shared Cores",
    "category": "Baku-Gear & BakuCores",
    "preview": "Haos Titan Pandoxx treats BakuCores attached to your other Bakugan as attached to itself, without removing their bonuses from those Bakugan. This includes applicable Gear discounts while Pandoxx is closed.",
    "transcript": "8.) How does Haos Titan Pandoxx work? It's effect text states \"treat all BakuCores attached to your other\nBakugan as though they are attached to this.\"\n8a.) Does this mean my bakugan do not get their core bonuses, as they are technically attached to\nPandoxx?\n\nDev Response: Your other Bakugan still get the bonuses.\n\n8b.) A specific situation for Titan Pandoxx and Gear reduction cores:\ni.) If I have one -2 gear reduction core on one Bakugan and two on the other, can I play a 6\ncost bakugear on Titan Pandoxx for free while it is closed and was not selected for rolling\nthis turn?\n\nDev Response: Yes, Titan Pandoxx is treated as though it holds all of those cores, even\nwhile closed. The cost reduction applies.",
    "mentionedCards": [
      "Haos Titan Pandoxx",
      "Haos Titan Pandoxx Ultra"
    ]
  },
  {
    "number": 9,
    "slug": "q9",
    "title": "Evo Core bonuses applied after opening",
    "category": "Baku-Gear & BakuCores",
    "preview": "An Evo played after a Bakugan opens still grants any applicable bonuses based on the BakuCores attached to that Bakugan.",
    "transcript": "9.) If I play an evo with a core bonus on it after I roll the Bakugan, do I get that bonus, or can I only get these\nbonuses when the Bakugan opens on that core?\n\nDev Response: The Bakugan still gets the bonus, even after the Evo is played.",
    "mentionedCards": []
  },
  {
    "number": 10,
    "slug": "q10",
    "title": "Ninja Gear during damage or Brawl",
    "category": "Brawls, Damage & Rerolls",
    "preview": "Ninja Gear cannot undo damage after the damage amount is locked in. During the Brawl, closing your only open Bakugan causes you to lose that Brawl.",
    "transcript": "10.) What happens if I play Ninja Gear during combat step, targeting my currently active Bakugan?\n\nDev Response: If you are asking about playing this while damage is being dealt, the damage rating has\nalready been locked in and will continue as normal.\n\n10a.) Do I get to play a reroll card after Ninja Gear resolves to return my Bakugan to the battle, or\ndoes the battle end as a state-based action once my Bakugan leaves?\n\nDev Response: Reroll effects can only be played prior to the victor being declared.\n\n10 Follow Up: Sorry, this is worded incorrectly. Combat step is meant to refer to the brawl phase: when both\nplayers are brawling to decide a victor and move into victor phase. If I play Ninja Gear during the brawl phase, does my\nbakugan close and I automatically lose the brawl? Or am I able to play a reroll on my closed bakugan, after my ninja\ngear has resolved.\n\nDev Response: The Bakugan would close. The player with no open Bakugan would lose the brawl.",
    "mentionedCards": [
      "Ninja Gear"
    ]
  },
  {
    "number": 11,
    "slug": "q11",
    "title": "“When you play this” triggers and negation",
    "category": "Timing, Batch & Effect Resolution",
    "preview": "A “when you play this” trigger enters the batch when its card is played. Negating the card does not negate a separate triggered effect already on the batch.",
    "transcript": "11.) When a hero or evo card says its effect happens \"when you play this\", does the effect get added to the\nbatch right when you actually play it, or does it get added upon resolution of the card with the effect?\n\nDev Response: The effect goes on the batch when the card is played.\n\n11a.) When is a card technically played? if a card is negated, does it count as being played? If a\nbakugear or hero gets negated, would the “when you play this” effect also be negated?\n\nDev Response: If a negate targets effects, it can negate effects on the batch. If it targets cards, it\ncan only stop a card from resolving off the batch, not any triggered effects that playing the card\ncaused.\n11 Follow Up: A couple things regarding effect texts:\n1.) Does this mean that there is no way to interact with Mac the turn someone plays it? It has the effect text “The\nturn you play this, the Victor is decided by highest Dmg instead of B.” Can I not use sinkhole/deep illusion to\nstop this effect from coming into play?\n2.) We currently have zero negates in this game that can “negate effect texts.” We can only negate specific card\ntypes. Does this mean I cannot prevent the effects of “When you play this” cards, as they will always just\nhappen?\n\nDev Response: As written, Mac’s effect currently can’t be negated with the current card pool.",
    "mentionedCards": [
      "Mac",
      "Sinkhole",
      "Deep Illusion"
    ]
  },
  {
    "number": 12,
    "slug": "q12",
    "title": "Flip Hero cards and Hero/Flip effects",
    "category": "Flip, Reveal & Discard Interactions",
    "preview": "Flip Heroes are both Flip and Hero cards: effects that play Heroes may play them, but restrictions against Flip cards still apply. Luck Aura can play them to stop damage when applicable.",
    "transcript": "12.) Can I play a \"flip hero\" from hand or deck if a card allows me to play a \"hero\" type card in this manner?\n12a.) If Age of Aurelus Lia finds Well Practiced in the top 3 cards of my deck, can Lia's effect allow\nme to play Well Practiced?\n\nDev Response: Yes, a flip hero has the Hero card type, so if an effect lets you play a Hero, it applies\nto Flip Hero cards.\n\n12 Follow Up: A couple things regarding flip heroes:\n1.) Am I able to play flip heroes off a card like Dan (BB)? It states non-flip cards, but it would be nice to know if\none can play a flip hero.\n2.) If I flip over Luck Aura, and pay for it: can I play a flip hero from my hand? If I do, does this stop the damage\nfrom the incoming attack and then get my flip hero into play?\n3.) Do hero/flip reducing cards (Strata BR/Lightning BB) reduce flip heroes?\n\nDev Response:\n1) Flip Hero cards are still flip cards, so they can’t be played by Dan.\n2) You can play a Flip Hero from your hand off of Luck Aura and it would stop damage if applicable.\n3) Yes",
    "mentionedCards": [
      "Age of Aurelus Lia",
      "Well Practiced",
      "Luck Aura",
      "Dan Kouzo",
      "Strata",
      "Lightning"
    ]
  },
  {
    "number": 13,
    "slug": "q13",
    "title": "Negating a Flip Hero",
    "category": "Flip, Reveal & Discard Interactions",
    "preview": "Negating a Flip Hero prevents it from entering play and prevents all its effects, including Stop.",
    "transcript": "13.) In conjunction with the previous question, can flip heroes be negated by hero negates? (sinkhole and\ndeep illusion)\n\nDev Response: Yes\n\n13 Follow Up: Since flip hero cards can be negated, what exactly happens when I negate an opponent's flip hero\ncard when it is revealed from their deck as a result of taking damage?\n\nDev Response: The entire card is negated. It won’t enter play and its effect won’t take place, including the stop.",
    "mentionedCards": [
      "Sinkhole",
      "Deep Illusion"
    ]
  },
  {
    "number": 15,
    "slug": "q15",
    "title": "BakuCores may attach only to open Bakugan",
    "category": "Baku-Gear & BakuCores",
    "preview": "BakuCores can be attached only to open Bakugan, even when an effect would otherwise attach a Core from the field.",
    "transcript": "15.) Glimmering Glaive and Enlightened Focus state to \"attach a BakuCore from the Field to one of your\nBakugan.\"\n15a.) Are you allowed to attach a BakuCore to one of your closed Bakugan? Or is it a misprint, and\nthat you can only attach a BakuCore to an open Bakugan?\n\nDev Response: Bakugan must be open to have cores attached to them.",
    "mentionedCards": [
      "Glimmering Glaive",
      "Enlightened Focus"
    ]
  },
  {
    "number": 16,
    "slug": "q16",
    "title": "Haos Titan Nillious opening effect",
    "category": "Evolutions, Heroes & Character Abilities",
    "preview": "Haos Titan Nillious must already be in play as it opens with a Magic Shield to gain its extra-Core effect; that effect is static and does not enter the batch. Pyrus Hyper Serpenteze’s opening ability is a trigger instead.",
    "transcript": "16.) HTN appears to have been made into a static effect by the latest ruling. So does bonus apply (assuming\nconditions are met) when the evo is played? (same as ATHU) or does HTN have his very own set of rules\nwhereby the effect is static BUT the evo must be played prior to rolling onto a MS?\n\nDev Response: For this ability to occur, the Evo must be in play as the core is picked up.\n\n16a.) Does HTN have to land on the MS to get the attach a core effect or can a card like aquify,\nglimmering glaive or others cause the effect to go off without landing on it? Two situations in\nparticular come to mind:\ni) Player A rolls HTN onto a Non-MS core, then, player A plays glimmering glaive to target a\nmagic shield and attaches the MS core to HTN. Does the HTN core effect now go off to total\n3 cores on HTN?\nii) if HTN rolls onto a non-MS core, and the opponent rolls onto a MS, then, HTN’s owner\nplays aquify to switch cores, does the HTN core effect go off when the magic shield\nattaches this way?\n\nDev Response: The way this evo needs to be worded is, “As this opens, if a MS is attached\nto it, attach another core from the field to this.” This is a static effect that does not enter the\nbatch. We will be adding this to the eratta section of the comp rules.\n\n16 Follow Up: If this is the case for Haos Titan Nillious, does this mean that this is also how Pyrus Hyper\nSerpenteze works? Does the burn effect become a static effect that just happens on open, and cannot be interacted\nwith?\n\nDev Response: The functions are slightly different. Pyrus Hyper Sepenteze is worded properly as a trigger and\nfunctions properly as such. This open trigger goes onto the Batch and can be responded to.",
    "mentionedCards": [
      "Haos Titan Nillious",
      "Pyrus Hyper Serpenteze",
      "Aquify",
      "Glimmering Glaive"
    ]
  },
  {
    "number": 17,
    "slug": "q17",
    "title": "Simultaneous Haos Titan Nillious effects",
    "category": "Evolutions, Heroes & Character Abilities",
    "preview": "If two Haos Titan Nillious opening effects occur together, the turn leader applies their effect first.",
    "transcript": "17.) If two HTNs open simultaneously, what happens? How do you decide who picks up their core first?\n\nDev Response: Turn leader adds first.",
    "mentionedCards": [
      "Haos Titan Nillious"
    ]
  },
  {
    "number": 18,
    "slug": "q18",
    "title": "Stacking and destroying Evo cards",
    "category": "Evolutions, Heroes & Character Abilities",
    "preview": "Playing a new Evo leaves earlier Evos underneath. An effect destroying one Evo removes only the top Evo, while an effect destroying all Evos also removes those beneath it.",
    "transcript": "18.) When I play an evo card on top of another evo card, where does the previous evo card go? Does it stay\nunder the new card, or go to my discard pile?\n\nDev Response: It stays underneath.\n\n18 Follow Up: How do evo destruction cards (Wax, Wane, Sonic Chain, Haos Titan Gorthion Ultra, Crystal Blaster)\nwork if we can stack evos?\n18a.) Wane and Sonic Chain specify singular evos, does this mean “destroy the top\ncopy of one Bakugan’s evo” or is it “destroy all copies of an evo on a single Bakugan”?\n18b.) Wax, Haos Titan Gorthion, and Crystal Blaster all destroy more than a single evo\ncard. Do they destroy every single copy of every single evo that the opponent has? (and\nin the case of gorthion, every copy that you have.)\n\nDev Response:\n18a) Yes, these cards will leave the Evo cards below the top Evo that is destroyed.\n18b) These effects destroy all, including Evo cards below the top",
    "mentionedCards": [
      "Wane",
      "Sonic Chain",
      "Wax",
      "Haos Titan Gorthion Ultra",
      "Crystal Blaster"
    ]
  },
  {
    "number": 19,
    "slug": "q19",
    "title": "Age of Aurelus Lia and card order",
    "category": "Flip, Reveal & Discard Interactions",
    "preview": "Age of Aurelus Lia does not allow the top three cards viewed with her effect to be rearranged. Their original order must be preserved.",
    "transcript": "19.) Age of Aurelus Lia states “When you open a Bakugan, look at the top three cards of your deck. If one of\nthose is a Hero card, you may play it for free.” Does this effect allow players to put these cards back on top of\ntheir deck in any order, or will players have to put them back in the same order?\n- The Sky’s Hymn states that you may put the cards back in any order, this does not (which implies\nthat you put them back in the same order.)\n- If you must put them back in the same order, how is this supposed to be judged? Is a judge\nsupposed to know the top three cards of a player’s deck every time they open their Bakugan? This\nseems very hard to rule and heavily relies on an honor system of the player to not reorder their top\nthree cards.\n\nDev Response: Lia doesn’t allow players to rearrange the order. Players should be able to see if their opponent\nis rearranging the order. If they believe their opponent is not following the instructions, a judge can be called to\nobserve. If a player is regularly accused of such things, they can have escalating consequences.\n\n19 Follow Up: This reliance on the honor system still seems like an issue. If one’s opponent is rearranging their\ntop three cards off of Lia’s effect, it really can’t be stopped by the one playing against it and bringing a judge to\nobserve can just lead to a player simply not rearranging.\n- Would you consider errata-ing the card to either state “the player reveals the top three cards and then\nchooses a hero,” or that they can simply put the cards back in any order?\n\nDev Response:        We will consider it but no changes are planned at this time.",
    "mentionedCards": [
      "Age of Aurelus Lia",
      "The Sky's Hymn"
    ]
  },
  {
    "number": 20,
    "slug": "q20",
    "title": "Magnus, Ultimate Rival searches and stacking",
    "category": "Evolutions, Heroes & Character Abilities",
    "preview": "Magnus, Ultimate Rival puts its searched card into your hand before shuffling. Three copies each grant +300 B-Power and +3 Damage, totalling +900 and +9.",
    "transcript": "20.) Magnus, Ultimate Rival states “When you play this, search your deck for a card. Then shuffle your deck.”\n“If you have three of this in play, your Bakugan get +300B and +3Dmg.”\n- What happens with this card search? Does the card go into my hand, or do I just look at it before I\nput it back into my deck?\n- If I have three Magnus, Ultimate Rival in play, do I get each of their bonuses for a total of +900B and\n+9Dmg, or am I only getting a buff of +300B and +3Dmg?\n\nDev Response:\n-   This card should have been written to say that the card goes to your hand before your deck is\nshuffled\n-   Each of the Hero cards will give +300 and +3, resulting in a +900, +9 bonus",
    "mentionedCards": [
      "Magnus, Ultimate Rival"
    ]
  },
  {
    "number": 21,
    "slug": "q21",
    "title": "Aurelus Hyper Trox and optional rerolls",
    "category": "Evolutions, Heroes & Character Abilities",
    "preview": "Aurelus Hyper Trox receives its bonus when you play an optional-reroll Action on it, even if you choose not to reroll.",
    "transcript": "21.) If a player has selected Aurelus Hyper Trox as their Bakugan for the turn, and they are currently in the\nbrawl phase with their opponent, if they play a card like Deep Dive (1 energy/ “draw a card and you may reroll\nyour bakugan”) and if the player chooses to not reroll trox, do they still get the effect bonus activation of\naurelus trox? (Aurelus Hyper Trox states “when you play an action card on this, this gets +300B and +4Dmg.”)\n21a.) This interaction currently only occurs with cards like Quickfire and Deep Dive, where the cards\nstate you may reroll a Bakugan, and their secondary effects do not directly target Trox (Dark Waters\nfor example would, as even if you don’t reroll you still give +200B.)\n\nDev Response: You are technically still selecting Trox to play the card on. The may effect is part of the effect\nof the card. You can opt not to Reroll and still have selected the Trox.",
    "mentionedCards": [
      "Aurelus Hyper Trox",
      "Deep Dive",
      "Quickfire",
      "Dark Waters"
    ]
  },
  {
    "number": 22,
    "slug": "q22",
    "title": "Toshi copying Superfuel",
    "category": "Timing, Batch & Effect Resolution",
    "preview": "When Toshi copies Superfuel, the two Superfuel effects require separate rerolls. Each successful reroll adds its own discount to the next card.",
    "transcript": "22.) If a player has Toshi in play (9 energy/ “When you play this, search your deck for an Action card and\nreveal it, then put it into your hand. Shuffle your deck.” “Copy the first Action card you play each turn.”) and\nthey play superfuel as their first action card this turn, what happens?\n-Superfuel states that “you must reroll your Bakugan.      If you open on the reroll, the next card you\nplay this turn costs 3 energy less to play.” How does this effect interact with Toshi?\n\nDev Response: Two Superfuel effects would enter the Batch. One from the card, and then one from Toshi's\neffect. This would make you have to Reroll twice. The superfuel effects happen independent of each other, so\nif you open on one out of two, you get a 3 energy discount on your next card. If you open on both, the next card\nwould cost you 6 energy less.",
    "mentionedCards": [
      "Toshi",
      "Superfuel"
    ]
  },
  {
    "number": 23,
    "slug": "q23",
    "title": "Might of Cyndeus and Dark Rage resolution",
    "category": "Timing, Batch & Effect Resolution",
    "preview": "The alternative Victor conditions on Might of Cyndeus and Dark Rage take effect only when those Action cards resolve.",
    "transcript": "23.) In response to answers from question 11, both Might of Cyndeus and Dark Rage have the text “This\nturn, the victor is decided by highest DAMAGE instead of B-POWER.” Are these effects that come in separately\nfrom the card itself? Or will this condition only activate when the card itself resolves?\n\nDev Response: Those effects will work just like any other action effect. Once the card is played from hand, the\ncard goes on the batch. If it resolves, the card text happens.",
    "mentionedCards": [
      "Might of Cyndeus",
      "Dark Rage"
    ]
  },
  {
    "number": 24,
    "slug": "q24",
    "title": "When Glimmering Glaive selects a BakuCore",
    "category": "Timing, Batch & Effect Resolution",
    "preview": "Glimmering Glaive selects which BakuCore to attach when its effect resolves, not when the card is played.",
    "transcript": "24.) Does a card like glimmering glaive, whose effect text reads “when you play this, you may attach a\nBakuCore from the field to one of your (open) Bakugan,” have to have the BakuCore declared on cast, or on\nresolution?\n\nDev Response: The selection happens on resolution.",
    "mentionedCards": [
      "Glimmering Glaive"
    ]
  },
  {
    "number": 25,
    "slug": "q25",
    "title": "When played abilities enter the batch",
    "category": "Timing, Batch & Effect Resolution",
    "preview": "A “when you play this” effect triggers and enters the batch when its card enters play or resolves.",
    "transcript": "25.) When a card with a “when you play this” effect enters the batch and is able to resolve, will the effect\ntext resolve at the same time as the card? Or is it once the card resolves, then the effect gets added into the\nbatch and has to wait for itself to resolve.\n\nDev Response: Once the card enters play or resolves, the effect will trigger and go on the batch.",
    "mentionedCards": []
  },
  {
    "number": 27,
    "slug": "q27",
    "title": "Ventustability and previously flipped cards",
    "category": "Flip, Reveal & Discard Interactions",
    "preview": "Ventustability may return an eligible card flipped at any time during that turn, including a card flipped by another effect.",
    "transcript": "27.) Ventustability is a flip card in Fusion Force that reads “3 energy/ If you have flipped three or more cards\nthis attack, stop non-ventus and choose a card that was flipped this turn and put it in your hand.”\n-Does this mean if I used a burn attack on my opponent this turn, then lose the brawl phase but\nactivate Ventustability, could I take one of the cards I burned from my opponent and put it into my\nhand?\n\nDev Response: Yes, any card flipped that turn would be able to be returned, including the cards flipped from a\ncard effect that same turn.",
    "mentionedCards": [
      "Ventustability"
    ]
  },
  {
    "number": 28,
    "slug": "q28",
    "title": "Toshi played after the first Action",
    "category": "Evolutions, Heroes & Character Abilities",
    "preview": "Toshi does not copy a later Action if the turn’s first Action was already played before Toshi entered play.",
    "transcript": "28.) If I play Toshi during one of my turns, and I have already played my first action card for the turn before I\nplay Toshi, will Toshi copy that first action card after he himself resolves? Or will Toshi only copy action cards\nif they are the first each turn after having him on the board?\n\nDev Response: Toshi only copies the first action card played, so if you have already played an Action card by\nthe time Toshi enters play, the next one will not be copied.",
    "mentionedCards": [
      "Toshi"
    ]
  },
  {
    "number": 29,
    "slug": "q29",
    "title": "Evo cards for Fusion Bakugan",
    "category": "Card Identity, Deckbuilding & Errata",
    "preview": "An Evo for a Fusion Bakugan may be played only onto that Bakugan’s matching fused face.",
    "transcript": "29.) How do evos for fusion bakugan work? We have currently seen evolutions for diamond minotaur x\nzentaur and diamond eenoch x nillious, and these have brought up confusion on how they work in conjunction\nto fusion character cards.\n\nDev Response: Evo cards can only be played on the version it matches. So, a Fuse Evo can only be played on\nthe Fuse side of a Bakugan.",
    "mentionedCards": [
      "Diamond Minotaur x Zentaur",
      "Diamond Eenoch x Nillious"
    ]
  },
  {
    "number": 30,
    "slug": "q30",
    "title": "Dual Baku-Gear attachment order",
    "category": "Baku-Gear & BakuCores",
    "preview": "A Dual Baku-Gear and a regular Baku-Gear can remain attached to the same Bakugan regardless of which was played first.",
    "transcript": "30.) In regards to dual Baku-Gear cards, if I attach the Dual gear before I attach a regular Baku-Gear, am I\nstill able to attach the regular Baku-Gear? To clarify:\n-Are Gears and Dual Gears affected by placement order?\nIf I play a dual gear on my bakugan first, does that take up the first slot for a gear and the\nregular gear cannot be played?\n-Or do the two gear slots work as Gear Slot 1 for any Regular Gear, Gear slot 2 is for any Dual Gear.\n\nDev Response: By rule, Bakugan can only have one Gear attached at any time. This means that if you play a\nsecond Gear onto a Bakugan, you must choose one of the two attached Gear cards to discard before the game\ncan proceed. Dual Gear can be attached or remain attached to a Bakugan as a second gear. This means that\nas long as one of the two Gear cards attached to a Bakugan has this ability, it is ok. The dual Gear can be\nplayed first or second.",
    "mentionedCards": []
  },
  {
    "number": 31,
    "slug": "q31",
    "title": "Glimmering Glaive: selecting a Core for its trigger",
    "category": "Timing, Batch & Effect Resolution",
    "preview": "For Glimmering Glaive’s triggered effect, the BakuCore is chosen when the triggered effect resolves.",
    "transcript": "31.) In reference to questions #24 and #25, when I play the card glimmering glaive, do I have to declare my\ntarget core on the resolution of the card itself? Or do I declare my target core on the resolution of the effect?\n\nDev Response: The Core is chosen as part of resolution on the effect.",
    "mentionedCards": [
      "Glimmering Glaive"
    ]
  },
  {
    "number": 32,
    "slug": "q32",
    "title": "Swapping BakuCores requires an attached Core",
    "category": "Baku-Gear & BakuCores",
    "preview": "A Bakugan must have at least one BakuCore attached to it to be selected for a BakuCore swap.",
    "transcript": "32.) What are the conditions that Aquify (1 energy/ Swap the Bakucores attached to the Bakugan you rolled\nthis turn and the opposing Bakugan.) needs to meet in order for it to resolve properly?\n-There is current discussion as to whether or not both Bakugan need to have at least 1 core attached\nin order to swap cores. Some people are stating that one can swap cores with the other player if one\nplayer does not hold any cores on their active bakugan.\n32a.) Similarly, what are the conditions needed for Ventus Diamond Turtonium and Ventus Hyper\nTurtonium Ultra? (4 energy/ When this opens, you may swap one of this Bakugan’s BakuCores with\nthe opposing Bakugan.)\n\nDev Response: There needs to be a core attached to a Bakugan for you to swap with it.\na)   You have to select a Bakugan that is holding a Core to be able to Swap.",
    "mentionedCards": [
      "Aquify",
      "Ventus Diamond Turtonium",
      "Ventus Hyper Turtonium Ultra"
    ]
  },
  {
    "number": 33,
    "slug": "q33",
    "title": "Howling Shell Bomb timing after a reveal",
    "category": "Timing, Batch & Effect Resolution",
    "preview": "Howling Shell Bomb must be played for free, if desired, at the moment another card causes it to be revealed.",
    "transcript": "33.) If a player reveals Howling Shell Bomb (5 energy/ +1000B.               If another card causes you to reveal\nthis card from your hand, you may play this for free.) via a corresponding sync card, when does the ability to\nplay the card for free no longer become applicable?\n-With the way the card is currently worded, some people believe that this effect can be played at any\ntime during a turn after it has been revealed from hand.\n\nDev Response: The decision must be made when the card is being revealed.",
    "mentionedCards": [
      "Howling Shell Bomb"
    ]
  },
  {
    "number": 34,
    "slug": "q34",
    "title": "Darkushadow, dual Factions and Howling Shell Bomb",
    "category": "Flip, Reveal & Discard Interactions",
    "preview": "Darkushadow affects dual-Faction cards containing the named Faction. A revealed Howling Shell Bomb cannot be played if the effect discards it before its ability can trigger.",
    "transcript": "34.) If my opponent plays Darkushadow (4 energy/ Choose a Faction [Aquos, Darkus, Haos, Pyrus, or\nVentus.] Your opponent reveals their hand and discards all cards of the chosen faction.) and chooses Aquos:\n34a.) Will this include dual faction cards that include aquos (Aquos/Darkus and Aquos/Ventus?)\n34b.) Assuming the answer to the previous question is “yes,” if I reveal my hand and Howling Shell\nBomb (5 energy/ +1000B. If another card causes you to reveal this card from your hand, you may\nplay this for free.) is one of the revealed cards, can I use its effect to play Howling Shell Bomb before\nor after it gets discarded by Darkushadow?\n34c.) What happens if I have Howling Shell Bomb in hand, and they have chosen a faction that is\nneither Aquos nor Darkus? Am I able to play it after Darkushadow resolves?\n\nDev Response:\na)   Yes, it applies to dual faction cards that have the selected faction\nb)   No, Darkushadow reveals and discards as part of the resolution of its effect. Shell Bomb would be\ndiscarded before it could trigger and be played from your hand.\nc)   Yes, it would have been revealed in your hand, and at the moment of reveal, the player with Howling\nShell Bomb would be able to play the card.",
    "mentionedCards": [
      "Darkushadow",
      "Howling Shell Bomb"
    ]
  },
  {
    "number": 35,
    "slug": "q35",
    "title": "When to decide an optional “may” effect",
    "category": "Timing, Batch & Effect Resolution",
    "preview": "A player chooses whether to use an optional “may” triggered ability when that ability resolves.",
    "transcript": "35.) When does a triggered ability with “may” in its text need to be declared by the player?\n-Example: I roll Hyper Aquos Mantonoid Core (2 energy/ When this opens, you may swap a\nBakuCore attached to this with the opposing Bakugan.) for the turn and its core swapping\neffect enters the batch, my opponent plays a reroll in response. They reroll and land on a\ntrap core when previously on a highly desirable core, do I declare whether or not I will use\nability as its effect on the batch resolves? Or do I have to declare to use an effect as it\nenters the batch?\n\nDev Response: May effects are chosen upon resolution",
    "mentionedCards": [
      "Hyper Aquos Mantonoid Core"
    ]
  },
  {
    "number": 36,
    "slug": "q36",
    "title": "Excess Gear must be discarded immediately",
    "category": "Baku-Gear & BakuCores",
    "preview": "Excess Baku-Gear cards must be discarded before play continues; they cannot be counted temporarily for Ventus Maximus Barbetra’s cost reduction.",
    "transcript": "36.) In regards to Ventus Maximus Barbetra’s (10 energy/ This costs 3 energy less to play for each\nBaku-Gear attached to your Ventus Barbetra.) cost-reducing effect, is there a period where I could play multiple\nbaku-gear onto Barbetra, then respond by playing the evo before I have to discard down to one baku-gear?\n-Example: I roll Ventus Barbetra onto a core with -2 gear reduction cost, and I play three\nventusmashers gear (2 energy/ +200B and 0 Damage.) onto Barbetra. Is there a period of\ntime where I am able to play Ventus Maximus Barbetra for 1 energy before I have to choose\n2 ventusmashers to be discarded?\n\nDev Response: No. Extra Gear cards must be discarded before the game can proceed.",
    "mentionedCards": [
      "Ventus Maximus Barbetra",
      "Ventus Barbetra",
      "Ventusmashers"
    ]
  },
  {
    "number": 37,
    "slug": "q37",
    "title": "Reducing damage in a Team Attack",
    "category": "Brawls, Damage & Rerolls",
    "preview": "During a Team Attack, damage reduction affects the chosen Bakugan’s Damage Rating contribution, not the combined attack directly.",
    "transcript": "37.) If during the victor step, my opponent reduces the damage of my leading bakugan, does that reduce\nthe whole attack or just from the lead?\n-Example: I team attack with Darkus Ramparian (lead) with a damage rating of 2, Aquos Hydorous\nwith a damage rating of 6, and Ventus Dragonoid with a damage rating of 2. The total damage of the\nteam attack is 10. If my opponent plays a card like Shell Shield on my Ramparian for -9 damage,\nwould my team attack be 1 or 8?\n\nDev Response: It reduces only the lead Bakugan. The Team Attack total is added up and dealt at the same\ntime, with no windows to play cards in between. The example above would result in an 8 point team attack.\nHowever, the player could have used the damage reduction on Aquos Hydorous to reduce the team attack by\n6.",
    "mentionedCards": [
      "Darkus Ramparian",
      "Aquos Hydorous",
      "Ventus Dragonoid",
      "Shell Shield"
    ]
  },
  {
    "number": 38,
    "slug": "q38",
    "title": "Fusion Evo deckbuilding eligibility",
    "category": "Card Identity, Deckbuilding & Errata",
    "preview": "A Fusion Evo can be included in a deck if it shares a Faction with one of the three Bakugan on the team; a second Bakugan matching its other Faction is not required.",
    "transcript": "38.) Similarly to question #29, are the deckbuilding restrictions for fusion evo cards the same as the\ndeckbuilding restrictions for all dual faction cards?\n-Example: I am building a deck with a Fusion bakugan that is Aquos unfused, and want to use its Evo\nthat is Aquos/Ventus. Do I need a separate Ventus bakugan on my team to use the Evo?\n\nDev Response: No, Evo cards can be played in a deck as long as they match one of the three teams on your\nteam.",
    "mentionedCards": []
  },
  {
    "number": 39,
    "slug": "q39",
    "title": "Might of Cyndeus versus Might of Cyndeous",
    "category": "Card Identity, Deckbuilding & Errata",
    "preview": "Might of Cyndeus and the misprinted Might of Cyndeous promo are the same card for deck-construction limits.",
    "transcript": "39.) In the pyrus faction bundle, the promo card that gets extended art and hex foiling is the Battle Brawlers\ncard Might of Cyndeus (2 cost/ +1 Damage.       This turn, the victor is decided by highest DAMAGE instead of\nB-POWER.) However, this version of the card is printed as “Might of Cyndeous” when the first printing was\n“Might of Cyndeus.” Will we see an errata to the original printing of the card to ensure that a player could not\nuse both copies in their deck, since they technically have different names?\n-This question comes from rule 1.2.1 and its subtext, which state: “Decks may contain no more than\nthree copies of each card, identified by the card name in combination with the function of the card.”\nand “Cards that have the same name and same ability text but differ in some other way are still\nconsidered to be the same card for deck construction.”\n\nDev Response: The promo card is considered the same card that was released in Battle Brawlers for purposes\nof deck building.",
    "mentionedCards": [
      "Might of Cyndeus",
      "Might of Cyndeous"
    ]
  },
  {
    "number": 40,
    "slug": "q40",
    "title": "Evo compatibility across toy releases",
    "category": "Card Identity, Deckbuilding & Errata",
    "preview": "An Evo can be played only on its intended Bakugan toy version, even if a different release has the same name and Faction.",
    "transcript": "40.) The official, complete rulebook currently states nothing about evo cards needing to match a character\ncard based on artwork, only by name and faction. With Armored Alliance, we have been told that you cannot\nplay evos from year 2 card sets onto year 1 bakugan or the other way around.\n40a.) Just want to confirm that this is official, and not misinformation.\n-Example: It is illegal for one to play Pyrus Titan Dragonoid BB onto Pyrus Dragonoid Core\nAV.\n40b.) If the answer to 40a is “yes” and artwork does matter when playing evos onto character cards,\nthen what happens with Ventus Barbetra? Its character card art does not match the small portrait on\nthe evo.\n\nDev Response: Evo cards are intended to pair with and only with one particular toy. The picture provided is\nintended to serve as the way to identify this. Ventus Barbetra will require a specific errata in the rules to clarify\nwhich Evo is paired with it.",
    "mentionedCards": [
      "Pyrus Titan Dragonoid",
      "Pyrus Dragonoid Core",
      "Ventus Barbetra"
    ]
  },
  {
    "number": 41,
    "slug": "q41",
    "title": "Opening triggers persist if their Core moves",
    "category": "Timing, Batch & Effect Resolution",
    "preview": "Pyrus Hyper Serpenteze’s opening trigger resolves after entering the batch even if it no longer holds the Fire Fist that triggered the effect.",
    "transcript": "41.) If one player rolls Pyrus Hyper Serpenteze and lands on a fire fist, and its “when this open” effect goes\ninto the batch, if the core is no longer there when the effect is resolving on the serpenteze, will the burn effect\nstill happen or does it fizzle? Or does the burn effect check on open?\n\nDev Response: Once the effect goes on the batch, it will resolve regardless of whether it is holding a fire fist.",
    "mentionedCards": [
      "Pyrus Hyper Serpenteze"
    ]
  },
  {
    "number": 42,
    "slug": "q42",
    "title": "Playing normal Flip cards through Luck Aura",
    "category": "Flip, Reveal & Discard Interactions",
    "preview": "Luck Aura can allow an ordinary Flip card to be played from hand to stop damage, when the Flip’s conditions are met.",
    "transcript": "42.) Similarly to question #12, if flip heroes can be played off of luck aura to stop incoming damage, can\nregular flips be played from hand off of luck aura to stop damage? (if applicable)\n\nDev Response: Yes, they can.",
    "mentionedCards": [
      "Luck Aura"
    ]
  },
  {
    "number": 43,
    "slug": "q43",
    "title": "Optic Beam and Greensight card-type errata",
    "category": "Card Identity, Deckbuilding & Errata",
    "preview": "Optic Beam is an Action card and Greensight is a Flip card; printings that label them otherwise are misprints.",
    "transcript": "43.) In the ventus faction bundle, both Optic Beam and Greensight are misprinted with the wrong card types.\nOptic Beam (Action - 5 cost/Your opponent must Reroll their Bakugan.          Turbo: If you have the most Energy\ncards in play, that Bakugan gets -500B.) is printed as a “Baku-Hero” and Greensight (Flip - 2 cost/Your\nopponent must Reroll their Bakugan.              Turbo: If you have the most Energy cards in play, that Bakugan\ngets -500B.) is printed as a “Baku-Action.”\n-Just want to confirm that these will be addressed and correctly errata’d.\n\nDev Response: These are misprints and are errata’d to exist in the game as only their proper type.",
    "mentionedCards": [
      "Optic Beam",
      "Greensight"
    ]
  },
  {
    "number": 44,
    "slug": "q44",
    "title": "Gear-reduction Core reset and unused reduction",
    "category": "Baku-Gear & BakuCores",
    "preview": "A used Gear discount does not reset each turn, but it resets when the BakuCore is picked up again or swapped. Unused reduction does not carry over to another Gear.",
    "transcript": "44.) In regards to updated rules towards Gear-Reduction Bakucores given in question #3:\n44a.) A player grabs a gear reduction core, plays a gear onto their bakugan, then plays a\nreroll and grabs a gear reduction core (either the same one they had before or a different\ngear reduction core) does the reduction on said core “reset?”\n\nDev Response: Yes, it will reset and add an energy cost reduction to the next gear that is played.\n\n44b.) If two players have gear reduction cores, and have both spent their reduction energy\non gears, would the energy on them be “reset” if a player played aquify and had the two\nplayers swap gear-reduction cores?\n\nDev Response: Yes.\n\n44c.) If I have 4 points of gear reduction on my bakugan (it has two cores that grant -2\nreduction) but I play a gear card that has a printed cost of 3 energy, will there still be 1\nenergy leftover or is all 4 energy gone?\ni.) If I have 4 points of gear reduction (two -2 gear cores), and play a gear that has\na printed cost of 2 energy, do the remaining 2 points get saved or used up?\n\nDev Response: In both cases, there is no further reduction. The reduction applies to the next gear played only.\n\n44d.) Does the way Haos Titan Pandoxx Ultra work with gear cores (previously responded\nto in question #8 of this document) change with this new ruling?\n\nDev Response: No. Haos Titan Pandoxx will create an extra instance of gear reduction cores for itself. The\n“next gear played” still applies for each instance of a gear reduction core that has been picked up.\n\n44e.) Do gear-reduction cores ‘reset’ after the end of a turn?\n-If I played a gear for a reduced cost on a bakugan, it wins and keeps said cores,\nand then we move onto the next turn, am I able to play another gear onto the\nbakugan that won the previous turn for a reduced cost?\n\nDev Response: No, it does not reset each turn.",
    "mentionedCards": [
      "Aquify",
      "Haos Titan Pandoxx Ultra"
    ]
  },
  {
    "number": 45,
    "slug": "q45",
    "title": "Core negation ends after the Core returns to the field",
    "category": "Baku-Gear & BakuCores",
    "preview": "Negating a BakuCore effect does not continue to affect that Core after it is returned to the field and picked up again.",
    "transcript": "45.)    When a player plays a card that negates a core’s effect (hot potato, inferno wings, etc) will the core’s\neffects still be negated if the opposing player rerolls onto the same bakucore after losing the core the first\ntime?\n\nDev Response: No, the negate effects will not track the core after it has been placed back onto the field.",
    "mentionedCards": [
      "Hot Potato",
      "Inferno Wings"
    ]
  },
  {
    "number": 46,
    "slug": "q46",
    "title": "Attack bonuses apply once in a Team Attack",
    "category": "Brawls, Damage & Rerolls",
    "preview": "A Team Attack counts as one attack, so an effect such as Wynton, the Hungry grants its attack-wide bonus only once.",
    "transcript": "46.) If a player has Wynton, the Hungry (Hero - 1 cost/Trifecta: If your Bakugan have three or more\nBakuCores attached to them, your Bakugan attacks get +3 Damage and + Shadowstrike.) on the board and\nhave just won their third battle (thus commencing a team attack), will all 3 bakugan get the +3 damage and the\n+shadowstrike, or is it only the leading bakugan?\n\nDev Response: Team attacks count as one attack, so this effect only applies once.",
    "mentionedCards": [
      "Wynton, the Hungry"
    ]
  },
  {
    "number": 47,
    "slug": "q47",
    "title": "Wynton, Bakugan Brawler copies do not stack",
    "category": "Evolutions, Heroes & Character Abilities",
    "preview": "Multiple copies of Wynton, Bakugan Brawler do not stack their effect that doubles reductions.",
    "transcript": "47.) If a player has multiple Wynton, Bakugan Brawler (Hero - 4 cost/When an effect would reduce an\nenemy’s B-Power or Damage, it is reduced by double that amount) on the board, will the Wynton effects stack?\n47a.) If they do stack, is the stack additive or multiplicative?\n\nDev Response: They do not stack. Having two in play is no different than having one.",
    "mentionedCards": [
      "Wynton, Bakugan Brawler"
    ]
  },
  {
    "number": 48,
    "slug": "q48",
    "title": "One Geogan per turn",
    "category": "Geogan & Nanogan",
    "preview": "Each player may play only one Geogan card per turn.",
    "transcript": "48.) If a player has played a geogan card for the turn, are they able to play another geogan card (whether it\nbe another copy of the same geogan, or a different geogan card)?\n\nDev Response: One geogan can be played per turn by each player.",
    "mentionedCards": []
  },
  {
    "number": 49,
    "slug": "q49",
    "title": "Geogan toys and deck copies",
    "category": "Geogan & Nanogan",
    "preview": "There is no limit on Geogan toys on a team. One Geogan toy can represent multiple legal card versions of that Geogan in the deck.",
    "transcript": "49.) Questions in regards to Geogan cards and toys when it comes to deckbuilding:\n49a.) Is there a limit to the amount of Geogan toys I can have on my team?\n\nDev Response: No limit.\n\n49b.) Will one Geogan toy represent the up-to 9 cards associated with that toy, and can\nthey all be put into a single deck?\n-Example: Will a single Darkus Sluggler toy represent 3 copies of Base Darkus\nSluggler, 3 copies of Mega Darkus Sluggler, and 3 copies of Darkus Diamond\nSluggler? And am I able to have all 9 of these cards in a single deck?\n\nDev Response: You can have all 9 of those cards in your deck and a single Darkus Sluggler toy can be used for\neach of them.",
    "mentionedCards": [
      "Darkus Sluggler",
      "Mega Darkus Sluggler",
      "Darkus Diamond Sluggler"
    ]
  },
  {
    "number": 50,
    "slug": "q50",
    "title": "Lia, Calm and Collected is static",
    "category": "Evolutions, Heroes & Character Abilities",
    "preview": "Lia, Calm and Collected’s limit of five damage from opposing Bakugan attacks is a static effect and applies without declaration.",
    "transcript": "50.) Is Lia, Calm and Collected (Hero - 5 cost/You can take a maximum of 5 damage from opposing\nBakugan attacks. Instabrawl: For 2 [Energy] (Put this Hero into play. At the end of the turn, it is destroyed.)) a\nstatic effect, or is it an effect I need to declare?\n-If I do not declare Lia’s effect before taking damage, will I take more than 5 damage?\n\nDev Response: It is static and needs to be maintained regardless of declaration.",
    "mentionedCards": [
      "Lia, Calm and Collected"
    ]
  },
  {
    "number": 51,
    "slug": "q51",
    "title": "Mythic Bakugan count as new Bakugan",
    "category": "Card Identity, Deckbuilding & Errata",
    "preview": "Mythic Bakugan are distinct from their older counterparts: they cannot use the older Evos, and both versions may be included on the same team.",
    "transcript": "51.)   Bakugan have released a new toy type called \"Mythic\" Bakugan, which rerelease toy\nmolds from Battle Planet but have new character cards and stats. These Bakugan re-use\nartwork for their character cards. Can Mythic Bakugan use the evolution cards of their older\ncounterparts? (ie: can Mythic Aquos Fangzor use the Aquos Hyper Fangzor evo card?)\n\nDev Response: From a card and team building standpoint, the mythic bakugan are brand new.\nYou can't use the old evos on them even if the toys match. You can have Mythic Hydorous and\noriginal Hydorous on the same team",
    "mentionedCards": [
      "Mythic Aquos Fangzor",
      "Aquos Hyper Fangzor",
      "Mythic Hydorous",
      "Hydorous"
    ]
  },
  {
    "number": 52,
    "slug": "q52",
    "title": "Nanogan team construction and ability timing",
    "category": "Geogan & Nanogan",
    "preview": "Each player may set aside up to three faction-legal Nanogan outside their deck, use each once per game and choose one effect per use. Their effects enter the batch and last for that turn.",
    "transcript": "52.)   Nanogan are newly introduced in Year 4. They have red card backs (signifying they can\ngo into your deck) however they do not have a printed Energy cost. How do these cards work, if\nthey even do work in the TCG?\n\nDev Response: Nanogan can be incorporated into the TCG but not shuffled into a deck. The\nbasics are:\n-Players can set aside a team of 3 nanogan in a game. Same faction rules as cards in\nyour deck, each nanogan must be in the faction of one of your 3 Bakugan. You may only\nhave 1 of any Nanogan on your team, similar to team construction.\n-During a brawl, you may flip over and reveal a nanogan to gain its effects. They have\nscaling benefits based on the cores held by your entire team.\n-You must choose just one of the outputs of a nanogan when used. Each nanogan may\nbe used once each game. You can use multiple in the same brawl, and only last for a\nsingle turn.\n-The toys are not required for TCG gameplay. They can manually open and close so they\ncan provide a fun way of tracking whether you have used a nanogan or not.\n\n52 Follow Up:         What are the timings for using a Nanogan and activating its effects?\n\nDev Response: Flipping over a Nanogan card and choosing one of its effects occur at the same\ntime and go onto the batch. Once the effect goes onto the batch, that effect will resolve no\nmatter if the cores that player controls get removed prior to the resolution. Once the nanogan\nresolves and its ability is applied, it is as though a BP boost was gained through an action card.\nIt lasts for the turn and is no longer tied to what cores a player's team holds.",
    "mentionedCards": []
  },
  {
    "number": 53,
    "slug": "q53",
    "title": "Add, remove and steal Core symbols",
    "category": "Baku-Gear & BakuCores",
    "preview": "The new Core symbols add, remove or steal a BakuCore. Their specified opening effects are static, bypass the batch and apply in player-priority order.",
    "transcript": "53.)    We have seen 3 new symbols on Character Cards and Nanogan Cards. They are\nhexagons with a +, a -, and an arrow on them. What do these symbols mean, and do they work in\nthe TCG?\n\nDev Response: The icons are \"add a core from the field to your active bakugan (+) \"remove a\ncore from the opposing active bakugan (-)\" and \"steal a core from the opposing active bakugan\n(arrow)\"\n\n53 Follow Up:        What are the timings for these core effects on Bakugan?\n\nDev Response: These effects activate similarly to HTN. They are worded as, “[X Core]: As this\nopens, if [X Core] is attached to it, [Activate the following effect].” This is a static effect that does\nnot enter the batch. If both players have these types of effects, the priority player activates their\neffect in its entirety first, then the next player in the turn order activates their effect.",
    "mentionedCards": []
  },
  {
    "number": 54,
    "slug": "q54",
    "title": "Evo-Rare all-Faction Characters",
    "category": "Card Identity, Deckbuilding & Errata",
    "preview": "An all-Faction Evo-Rare Character can be used as one chosen Faction for its deck and for effects that refer to that Faction.",
    "transcript": "54.)    A new rarity has been introduced in the toy line called Evo-Rare, which claims to be all\nfactions. Does this have any effect in the TCG, and if so how does it work?\n\nDev Response: In the TCG an all faction character can be played as any one faction. This means\nif the player claims it as ventus, they can include ventus cards in their deck and cards that affect\nventus characters will apply. You can also use those bakugan in other decks as any other\nfaction.",
    "mentionedCards": []
  },
  {
    "number": 55,
    "slug": "q55",
    "title": "Diamond Apophix Ultra Team Attack ability",
    "category": "Evolutions, Heroes & Character Abilities",
    "preview": "Diamond Apophix Ultra’s “Team Attack: Draw 2” activates whenever its team attacks, even if another Bakugan leads the attack.",
    "transcript": "55.)   The Diamond Apophix Ultra Evo card has the effect of \"Team Attack: Draw 2\". Does this\nmean Apophix Ultra needs to lead the team attack to draw 2 cards, or once you commence a\nteam attack, no matter who is leading, you draw 2 cards?\n\nDev Response: Team attack powers happen when a team attack occurs, regardless of who\nleads the team attack",
    "mentionedCards": [
      "Diamond Apophix Ultra"
    ]
  }
];
