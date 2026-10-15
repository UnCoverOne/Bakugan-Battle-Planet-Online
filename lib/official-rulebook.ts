// Transcribed from the uploaded Bakugan Battle Planet Official Complete Rulebook (2019).
// Preserve wording and source hierarchy; numbering is derived from list order.
export type OfficialRuleNode = { text: string; children: OfficialRuleNode[] };
export const OFFICIAL_RULEBOOK: OfficialRuleNode[] = [
  {
    "text": "Game Concepts",
    "children": [
      {
        "text": "General",
        "children": [
          {
            "text": "The following rules apply to the full version of the Bakugan game consisting of two players.",
            "children": [
              {
                "text": "For multiplayer rules, see section 8.",
                "children": []
              },
              {
                "text": "For cardless rules, see section 9.",
                "children": []
              }
            ]
          },
          {
            "text": "Before playing, each player is required to have three Bakugan toys along with their Character cards, six BakuCores, and a deck consisting of exactly 40 cards.",
            "children": [
              {
                "text": "A player’s BakuCores must match the six BakuCore indicators on their Bakugan Character cards.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Deck Construction",
        "children": [
          {
            "text": "Decks may contain no more than three copies of each card, identified by the card name in combination with the function of the card.",
            "children": [
              {
                "text": "Cards that have the same name and same ability text but differ in some other way are still considered to be the same card for deck construction.",
                "children": []
              }
            ]
          },
          {
            "text": "Players may not include cards in their deck that do not share a Faction with at least one Bakugan on their team",
            "children": []
          },
          {
            "text": "Players must use BakuCores that match the symbols indicated on the BakuCore indicator.",
            "children": []
          }
        ]
      },
      {
        "text": "The Ultimate Rules",
        "children": [
          {
            "text": "Cards can contradict the basic rules of the game. In the case that this happens, follow the text on the card.",
            "children": []
          },
          {
            "text": "The word “can’t” override any cards or effects that would otherwise happen.",
            "children": []
          },
          {
            "text": "Cards complete in the order that their text reads, from top to bottom.",
            "children": []
          },
          {
            "text": "If a card has an effect that can’t be completed, that part of the card is ignored. Continue completing any additional text on the card.",
            "children": []
          },
          {
            "text": "In the case that a player has multiple effects that occur at the same time, that player chooses the order for those effects to happen.",
            "children": []
          }
        ]
      },
      {
        "text": "Starting the Game",
        "children": [
          {
            "text": "Each player puts their three Character cards face down in front of them and places the corresponding, rolled up, Bakugan on top of the appropriate character card.",
            "children": []
          },
          {
            "text": "Randomly determine a player to be the starting player (see rule 7.5).",
            "children": []
          },
          {
            "text": "Beginning with the starting player, each player takes turns placing their six BakuCores in the center of the play area, starting equidistant from each player, one at a time.",
            "children": [
              {
                "text": "Each BakuCore, after the first, must be placed with at least one side completely touching another BakuCore.",
                "children": []
              }
            ]
          },
          {
            "text": "Each player shuffles their own deck and then gives it to their opponent who may also choose to shuffle or cut, then each player draws five cards from their own deck.",
            "children": []
          }
        ]
      },
      {
        "text": "Ending the Game",
        "children": [
          {
            "text": "When a player would be dealt any damage and there are no cards remaining in their deck, they lose the game.",
            "children": []
          }
        ]
      },
      {
        "text": "Factions",
        "children": [
          {
            "text": "There are six Factions in Bakugan: Aquos, Aurelus, Darkus, Haos, Pyrus, and Ventus.",
            "children": []
          }
        ]
      },
      {
        "text": "Energy",
        "children": [
          {
            "text": "Energy is the fundamental resource used to play cards and generate effects.",
            "children": [
              {
                "text": "The primary way to create Energy is by uncharging Energy cards (see rule 7.2.2.).",
                "children": [
                  {
                    "text": "Players may not uncharge an Energy card to produce Energy unless they need it to play a card.",
                    "children": []
                  }
                ]
              },
              {
                "text": "Players may spend any Energy they produce throughout the turn, but any unspent Energy disappears at the end of the turn.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Numbers",
        "children": [
          {
            "text": "1.8.1 Additive (+) numbers add to the total of whatever the player is counting.",
            "children": [
              {
                "text": "Negative (-) numbers subtract from the total of whatever it is the player is counting.",
                "children": [
                  {
                    "text": "If a Bakugan Damage Rating becomes negative, it is treated as 0 when counting damage and does not subtract from a Team Attack (see rule 5.12).",
                    "children": []
                  }
                ]
              },
              {
                "text": "The letter X will appear on some cards. This is a variable and can have different values throughout the game.",
                "children": [
                  {
                    "text": "While a card with an X in the cost is in your hand, deck, discard pile, or in play, the X counts as zero.",
                    "children": []
                  },
                  {
                    "text": "While a card with an X in the cost is in the batch (see rule 4.4), the X counts as whatever amount of energy was spent to pay X.",
                    "children": []
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "text": "Symbols",
        "children": [
          {
            "text": "Symbols are used to represent some of the basic elements of the game.",
            "children": [
              {
                "text": "Faction (see rule 1.5) icons are symbols that represent the different factions of Bakugan there are. These symbols are Haos (symbol), Ventus (symbol), Aquos (symbol), Pyrus (symbol), and Darkus (symbol).",
                "children": []
              },
              {
                "text": "Keyword icons are symbols that indicate a particular Keyword. These symbols are FrostStrike (symbol), DoubleStrike (symbol), and ShadowStrike (symbol).",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Cards",
        "children": [
          {
            "text": "Before a game starts, there are two places cards may appear: In a player’s deck and in a player’s Bakugan Character card zone. Only Bakugan Character cards can be found in the Bakugan Character card zone at the start of the game and are not to be shuffled into a player’s deck.",
            "children": []
          }
        ]
      },
      {
        "text": "Bakugan",
        "children": [
          {
            "text": "During a game, the Bakugan toy and the Character card that it comes with both represent the same Bakugan. The toy is the object used for rolling and playing the game, while the Character Card contains all the attributes and abilities of the Bakugan toy.",
            "children": []
          }
        ]
      },
      {
        "text": "BakuCores",
        "children": [
          {
            "text": "BakuCores are hexagon shaped discs that have two sides: a top side and a bottom side. On the top side there is only an icon identifier, while the bottom side will have modifying abilities that will interact with the Bakugan that pick the BakuCores up.",
            "children": []
          }
        ]
      },
      {
        "text": "Making Selections",
        "children": [
          {
            "text": "There are cards and abilities that will require their controller to make a selection. If a card or ability needs a selection, that selection must be made before the card can be played. If there are no selections available for that card or ability, the card cannot be played.",
            "children": [
              {
                "text": "In the instance that a selection is no longer valid after a card or ability has been played, the card attempts to complete as much of its text as possible.",
                "children": []
              },
              {
                "text": "Cards that affect Bakugan, but do not explicitly call out for a selection, can apply to any face-up Bakugan.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Priority and Timing",
        "children": [
          {
            "text": "At the start of each turn, the player who won the most recent Brawl becomes the starting player.",
            "children": [
              {
                "text": "The player who placed the final BakuCore during the game’s initial setup is the starting player on the first turn of the game.",
                "children": []
              }
            ]
          },
          {
            "text": "When a player has priority, they may choose to play cards and use abilities. If they choose not to add to the batch (see rule 4.4), the most recent card or ability added to the batch completes.",
            "children": [
              {
                "text": "Once a card or ability completes, priority is returned to the starting player.",
                "children": []
              }
            ]
          },
          {
            "text": "After the starting player makes any gameplay decisions, the non-starting player gets an opportunity to make theirs. This continues until each player decides to make no further game actions in sequential order.",
            "children": []
          },
          {
            "text": "Once a card or ability is played, that player retains priority. That player may continue to play additional cards or abilities before the opponent has a chance to act. Once the player with priority decides that they don’t have more to add to the batch (see rule 4.4), the other player is given priority.",
            "children": []
          },
          {
            "text": "While a card is completing and some parts of the card have taken effect, no players have priority. The card being played must finish its effects before the starting player gets priority again.",
            "children": []
          },
          {
            "text": "When there are no cards or abilities played and neither player adds to the batch (see rule 4.4), play continues to the next step.",
            "children": []
          }
        ]
      },
      {
        "text": "Costs",
        "children": [
          {
            "text": "A cost is any payment associated with using an ability or playing a card. Most costs are made in the form of Energy at the top right of a card, but there are also other costs that can modify a card. If there is an additional cost to pay when playing a card, it must be paid at the time the card or ability is being used, or else it is decided that the additional cost was not paid.",
            "children": []
          },
          {
            "text": "“Free” as a cost is the equivalent of the number 0. A free cost is subject to cost increase and decrease, starting from 0.",
            "children": [
              {
                "text": "A cost that is less than 0 is treated as 0.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Damage",
        "children": [
          {
            "text": "Dealing damage primarily comes from the Damage Rating of Bakugan Character Cards, but there are additional effects that can deal damage as well. When damage is being dealt, whatever initiated the damage is called the damage origin.",
            "children": [
              {
                "text": "Damage Rating must be modified before Damage begins being dealt.",
                "children": []
              },
              {
                "text": "Non- Character cards do not have Damage Rating, and therefor can not have their attacks modified by cards that increase or decrease Damage Rating.",
                "children": []
              }
            ]
          },
          {
            "text": "When taking damage, the player being dealt damage flips that many cards from the top of their deck, one at a time, and places them into their discard pile.",
            "children": []
          }
        ]
      },
      {
        "text": "Drawing a Card",
        "children": [
          {
            "text": "Players draw cards by taking the top card of their deck and putting it into their hand. Once per turn, this is a game action that takes place during the Start Phase (see rule 5.2), but there are also other effects that can cause a player to draw a card.",
            "children": []
          },
          {
            "text": "If there are no cards remaining in a player’s deck when they are directed to draw a card, the player skips that draw.",
            "children": []
          }
        ]
      },
      {
        "text": "Reroll effects",
        "children": [
          {
            "text": "Some effects allow players to Reroll their Bakugan.",
            "children": [
              {
                "text": "Reroll effects can only take place after the first roll of the turn.",
                "children": []
              },
              {
                "text": "Reroll effects can only be used on a Bakugan that was chosen during that turn’s Selection Step.",
                "children": []
              },
              {
                "text": "Reroll effects can’t be played on a roll in which both players rolled and both players failed to open their Bakugan.",
                "children": [
                  {
                    "text": "In this case, the next roll happens immediately, with both players rolling their Selected Bakugan",
                    "children": []
                  }
                ]
              },
              {
                "text": "Reroll effects can be played on a Bakugan that did not open but the opposing Bakugan did open.",
                "children": [
                  {
                    "text": "The opposing Bakugan remains open and can’t roll from this Reroll effect.",
                    "children": []
                  }
                ]
              },
              {
                "text": "Reroll effects can be played on a Bakugan that has opened.",
                "children": [
                  {
                    "text": "The opposing Bakugan remains in whatever state (open or not) it was from its last roll.",
                    "children": []
                  },
                  {
                    "text": "In the case where a Reroll effect is played and the roll is missed, and the opposing Bakugan is unopened, both players must roll as though both players missed their roll normally.",
                    "children": []
                  }
                ]
              },
              {
                "text": "Reroll effects have no other effect after the Victor Step begins",
                "children": [
                  {
                    "text": "Cards with Reroll effects can still be played for other effects on their card.",
                    "children": []
                  },
                  {
                    "text": "If a card states a Bakugan must Reroll, it can’t be executed before the first Roll of the turn or after the Victor Step begins.",
                    "children": []
                  }
                ]
              },
              {
                "text": "All normal rolling rules and procedures apply to rolls that come from Reroll effects.",
                "children": []
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "text": "Parts of a Card",
    "children": [
      {
        "text": "General",
        "children": [
          {
            "text": "The parts of a card are the name, energy cost, type line, faction, set indicator, text, art, BPower, Damage Rating, BakuCore indicator, legal text, collection number, Evo rating, Evo ID, and Hero ID. Some cards may have multiple or all of these traits. These parts are identified by holding the card vertically, but in the case of a Flip card, the card will need to be rotated horizontally.",
            "children": []
          }
        ]
      },
      {
        "text": "Name",
        "children": [
          {
            "text": "The name of a card is on the upper left corner.",
            "children": []
          }
        ]
      },
      {
        "text": "Energy Cost",
        "children": [
          {
            "text": "A card’s energy cost is listed in the top right corner.",
            "children": [
              {
                "text": "The energy cost of a card indicates what a player must spend from their energy pool to play a card.",
                "children": []
              }
            ]
          },
          {
            "text": "Any additional cost listed on a card isn’t a part of the energy cost.",
            "children": []
          },
          {
            "text": "If an effect allows for a card to be played for “free”, it means that the energy cost is zero.",
            "children": [
              {
                "text": "The Energy cost of a card indicates what a player must spend from their energy pool to play a card.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Type Line",
        "children": [
          {
            "text": "The type line is located directly below the Art. It conveys the card’s card type(s) and faction(s).",
            "children": []
          },
          {
            "text": "Card Types",
            "children": [
              {
                "text": "The card types are Action, Hero, Flip, Evo and Character.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Faction",
        "children": [
          {
            "text": "A card is the faction or factions indicated by the faction icons listed on the type line.",
            "children": [
              {
                "text": "The six factions are Aquos (Aquos), Darkus (Darkus), Haos (Haos), Pyrus (Pyrus), Ventus (Ventus), and Aurelus (Aurelus).",
                "children": []
              },
              {
                "text": "A card with two or more faction symbols is considered both factions.",
                "children": []
              },
              {
                "text": "Effects may change a card’s faction.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Set Indicator",
        "children": [
          {
            "text": "The set indicator conveys which card set a card was printed in. It is located on the bottom right corner.",
            "children": []
          }
        ]
      },
      {
        "text": "Text",
        "children": [
          {
            "text": "The text is printed on the lower half of a card.",
            "children": []
          },
          {
            "text": "A card’s text box may include italicized text, called flavor text, which has no game function.",
            "children": []
          }
        ]
      },
      {
        "text": "Art",
        "children": [
          {
            "text": "The art is found on the top half of the card.",
            "children": []
          }
        ]
      },
      {
        "text": "BPower",
        "children": [
          {
            "text": "Character and Evo cards have a BPower number listed on the left side of the card, under the Art. It is indicated by a number followed by the BPower symbol (BP).",
            "children": []
          },
          {
            "text": "If a Character or Evo card has a BPower value of zero or lower, it is considered to be zero.",
            "children": []
          },
          {
            "text": "If an effect sets a Character or Evo’s BPower to a specific value, it refers to a card’s “base (BP)”.",
            "children": []
          }
        ]
      },
      {
        "text": "Damage Rating",
        "children": [
          {
            "text": "Character and Evo cards have a Damage Rating number listed on the right side of the card, under the Art. It is indicated by a number followed by the damage rating symbol (DR).",
            "children": []
          },
          {
            "text": "If a Character or Evo card has a damage rating value of zero or lower, it is considered to be zero.",
            "children": []
          },
          {
            "text": "Effects that set a Character or Evo’s damage rating to a specific value, it refers to a card’s “base (DR)”.",
            "children": []
          }
        ]
      },
      {
        "text": "BakuCore Indicator",
        "children": [
          {
            "text": "Character cards have a BakuCore indicator listed on the top right of a card. It is indicated by two hex shaped icons with a symbol inside the icons.",
            "children": []
          },
          {
            "text": "Players must use BakuCores that match the symbols indicated on the BakuCore indicator.",
            "children": []
          }
        ]
      },
      {
        "text": "Art Credit",
        "children": [
          {
            "text": "There may be art credit is listed on the bottom left of a card. It has no game function.",
            "children": []
          }
        ]
      },
      {
        "text": "Legal Text",
        "children": [
          {
            "text": "The legal text lists the trademark and the copyright information. It is listed after the art credit and has no game function.",
            "children": []
          }
        ]
      },
      {
        "text": "Collection Number",
        "children": [
          {
            "text": "The collection number is on the bottom right of a card. It has no game function. It is shown in the form of [card number]/[total cards in the set].",
            "children": []
          }
        ]
      },
      {
        "text": "Evo Rating",
        "children": [
          {
            "text": "The evo rating is listed underneath the Evo ID. It is shown in the form of one or more * symbols.",
            "children": []
          }
        ]
      },
      {
        "text": "Evo ID",
        "children": [
          {
            "text": "The Evo ID is listed underneath in the card name.",
            "children": []
          },
          {
            "text": "An Evo ID instructs the player what Character(s) the Evo can be played on. An Evo may only be played on top of the Character listed in the Evo ID.",
            "children": []
          }
        ]
      },
      {
        "text": "Hero ID",
        "children": [
          {
            "text": "The Hero ID is listed underneath the card name.",
            "children": []
          },
          {
            "text": "The Hero ID is the title of the Hero card that differentiates the versions of a Hero.",
            "children": [
              {
                "text": "Example: A player may play up to three copies of each Dan Kuso with different Hero IDs. Dan Kuso with the Hero ID “Awesome One” is considered a different card than Dan Kuso with the Hero ID “Brawler Kid”.",
                "children": []
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "text": "Card Types",
    "children": [
      {
        "text": "General",
        "children": [
          {
            "text": "The different card types are Character, Evo, Hero, Action, Flip, and Energy cards.",
            "children": []
          }
        ]
      },
      {
        "text": "Character Cards",
        "children": [
          {
            "text": "The only cards that are not to be shuffled into a player’s deck are Character Cards. These cards provide specific details about the Bakugan that players roll during the game. Character cards begin the game face down.",
            "children": []
          }
        ]
      },
      {
        "text": "Evo Cards",
        "children": [
          {
            "text": "Evo cards may only be played on a Character card that matches in name and faction.",
            "children": [
              {
                "text": "The only restriction to playing an Evo card is that its name matches the base Character card at the bottom of the Character card pile (the Character card and all Evo cards on top of it)",
                "children": [
                  {
                    "text": "There is no order sequence to Evo cards (Hyper may be played on top of Titan, etc.)",
                    "children": []
                  },
                  {
                    "text": "The same Evo card may be played on top of itself (Hyper Fangzor on top of Hyper Fangzor is legal)",
                    "children": []
                  }
                ]
              }
            ]
          },
          {
            "text": "When an Evo card is played, it is placed on top of the Character Card of the appropriate Bakugan that player controls. If the Character Card was face down when the Evo card is played, first flip the Character Card face up, then play the Evo card on top of it.",
            "children": []
          },
          {
            "text": "Only the top-most Evo card’s stats and abilities are counted for a Bakugan. Evo card’s stats and abilities replace the underneath Character card’s stats and abilities.",
            "children": []
          }
        ]
      },
      {
        "text": "Hero Cards",
        "children": [
          {
            "text": "At any point that a player has priority, that player may cast a Hero card.",
            "children": []
          },
          {
            "text": "When a Hero card is played, place it in front of you on the play area. Hero cards remain in play until otherwise directed by a card or destroy effect.",
            "children": []
          }
        ]
      },
      {
        "text": "Action Cards",
        "children": [
          {
            "text": "At any point that a player has priority, that player may cast an Action card.",
            "children": []
          },
          {
            "text": "When an Action card is played, follow the text on the card, and then put it into your discard pile. If part of the card can’t be completed, that part of the card is ignored.",
            "children": []
          },
          {
            "text": "Action cards have an effect that only last throughout the turn. At the End phase, Bakugan revert to their original states.",
            "children": []
          }
        ]
      },
      {
        "text": "Flip Cards",
        "children": [
          {
            "text": "Players may only play Flip cards when they are flipped from the top of their deck due to damage being dealt. If a player is dealt damage and flips a Flip Card, that player chooses whether or not to play that card before any other player gets an opportunity to play any cards and before any remaining damage is dealt.",
            "children": []
          },
          {
            "text": "If a Flip Card is played during the Damage Phase, players may add to the batch (see rule 4.4) by following normal priority rules (see rule 1.13).",
            "children": []
          }
        ]
      },
      {
        "text": "Energy Cards",
        "children": [
          {
            "text": "During the Energize step (see rule 5.4) each player is given the opportunity to Energize (see rule 7.2.4) a card from their hand.",
            "children": []
          },
          {
            "text": "Energy cards have the card type Energy card while in play, but have their printed card type while in any other zone.",
            "children": []
          },
          {
            "text": "Players can no longer look at the text side of a card once it has been Energized.",
            "children": []
          }
        ]
      }
    ]
  },
  {
    "text": "Zones",
    "children": [
      {
        "text": "General",
        "children": [
          {
            "text": "A zone is any place a game piece can be during the game. There are six different zones: deck, hand, batch, discard pile, play area, and BakuCore Field.",
            "children": []
          },
          {
            "text": "Cards in decks and in the batch cannot change order during the game. In addition, BakuCores on the BakuCore Field may not be rearranged unless the rules (see rule 4.7) require it. Other zones may be arranged and rearranged at their controller's preference, as long as their opponent is made aware of the changes being made.",
            "children": []
          },
          {
            "text": "When a card moves zones, that card returns to its written text. Modifications to cards do not carry over from one zone to another.",
            "children": []
          }
        ]
      },
      {
        "text": "Deck",
        "children": [
          {
            "text": "A player’s deck must consist of exactly 40 cards that share Factions with the Bakugan on that player’s team. There can be no more than three copies of any card in a deck.",
            "children": []
          },
          {
            "text": "Each player’s deck must remain in a single face down pile. Players may not look at the cards in either player's deck, nor change the order of their contents during a game.",
            "children": []
          },
          {
            "text": "Players are allowed to ask for the remaining number of cards in the opponent's deck at any time. When a player is asked, they are allowed to pick up their deck and count it face down.",
            "children": []
          }
        ]
      },
      {
        "text": "Hand",
        "children": [
          {
            "text": "A player’s hand is where that player keeps cards that they have drawn throughout the game. There are additional effects that have the ability to put cards into a player's hand as well. A player may look at the cards in their hand at any time, but those cards remain hidden from their opponent's. At the start of the game, each player draws a hand of five cards.",
            "children": []
          },
          {
            "text": "Players are not allowed to have more than seven cards in their hand at the end of each turn. If a player does have more than seven cards at the end of a turn, that player must choose seven to keep, then discard the rest.",
            "children": []
          },
          {
            "text": "Players are allowed to ask for the number of cards in the opponent's hand at any time. When a player is asked, they must count their hand and tell the opponent the appropriate number.",
            "children": []
          }
        ]
      },
      {
        "text": "Batch",
        "children": [
          {
            "text": "When a card is played, that card enters the batch and when an ability is activated, that ability enters the batch.",
            "children": []
          },
          {
            "text": "In some cases, multiple effects may enter the batch at the same time. When two or more of these effects are controlled by a single player, that player may choose the ordering of their effects. In the case that some effects are controlled by different players, the starting player’s effects will enter the batch first, followed by the end of the batch going to the non-starting player’s effects.",
            "children": []
          },
          {
            "text": "Once both players pass priority and don’t add to the batch, the card or ability at the end of the batch resolves. Repeat this for each card or ability on the batch using priority rules (see rule 1.14).",
            "children": [
              {
                "text": "The end of the batch is the most recent card or ability played.",
                "children": []
              }
            ]
          },
          {
            "text": "Some effects in the game do not add to the batch.",
            "children": [
              {
                "text": "Uncharging Energy cards to gain energy does not use the batch. If a player uncharges an Energy card, that player retains priority until they play a card or use an ability.",
                "children": []
              },
              {
                "text": "BakuCores do not use the batch. If a BakuCore has an effect that will modify a Bakugan, that effect takes place immediately and cannot be responded to.",
                "children": []
              },
              {
                "text": "Some Bakugan have textbox abilities that are affected by BakuCores. These abilities do not use the batch.",
                "children": []
              },
              {
                "text": "Players may choose to forfeit at any time. Forfeiting a game does not use the batch.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Discard Pile",
        "children": [
          {
            "text": "A player’s discard pile is a combination of any cards that player has discarded, sacrificed, destroyed, or had negated. In addition, Action and Flip cards that have been played that game, and any damage that had been dealt to that player also go to that player’s discard pile.",
            "children": []
          },
          {
            "text": "The discard pile is a single face up pile that may be viewed and rearranged by any players.",
            "children": []
          }
        ]
      },
      {
        "text": "Play Area",
        "children": [
          {
            "text": "The play area is a combination of cards that stay in play from turn to turn. These cards consist of Character cards, Evo’s, Heroes, and Energy cards.",
            "children": []
          },
          {
            "text": "Cards in the play area do not go to the discard pile after they are used.",
            "children": []
          },
          {
            "text": "Cards in the play area that have the same card type must stay near other cards that share that card type and must remain visible.",
            "children": []
          }
        ]
      },
      {
        "text": "BakuCore Field",
        "children": [
          {
            "text": "Before a game starts, players will take turns placing BakuCores in the center of the play area in order to create a BakuCore Field. This is the zone that the Bakugan toys will be rolled towards in order to open and gain special abilities.",
            "children": []
          },
          {
            "text": "At all times there must be a clear path from a player to the BakuCore field with no cards in between.",
            "children": []
          },
          {
            "text": "When a BakuCore is placed, at least one side of that BakuCore must touch and be parallel with a side with another BakuCore on the BakuCore Field. If multiple BakuCores are being placed at the same time, the player placing them does so one at a time, in any order they choose.",
            "children": []
          }
        ]
      }
    ]
  },
  {
    "text": "Turn Structure",
    "children": [
      {
        "text": "General",
        "children": [
          {
            "text": "Each turn consists of the following four phases: Start Phase, Roll Phase, Brawl Phase, and End Phase. Each of these four phases are separated into additional steps.",
            "children": []
          },
          {
            "text": "Following priority rules (see rule 1.14), each phase is taken simultaneously by both players.",
            "children": []
          },
          {
            "text": "A phase can only end when both players have passed, in succession, with no cards or abilities remaining to be completed. Once a card or ability is completed, both players gain the opportunity to play additional cards and abilities during that phase.",
            "children": []
          },
          {
            "text": "Between each phase of the turn, no additional events can take place. The same is true for between turns.",
            "children": []
          }
        ]
      },
      {
        "text": "Start Phase",
        "children": [
          {
            "text": "The Start Phase consists of two steps: the Draw step and the Energize step. During this phase, players cannot play cards or use abilities.",
            "children": []
          },
          {
            "text": "The starting player is determined during the start phase",
            "children": []
          }
        ]
      },
      {
        "text": "Draw Step",
        "children": [
          {
            "text": "The first thing that happens in the Start Phase is each player simultaneously draws a card from their deck and puts it into their hand.",
            "children": []
          }
        ]
      },
      {
        "text": "Energize Step",
        "children": [
          {
            "text": "Starting with the starting player, both players are given the opportunity to Energize a card from their hand.",
            "children": []
          },
          {
            "text": "Once a player makes a decision to Energize a card or not, they will not get another opportunity to Energize a card during this step.",
            "children": []
          }
        ]
      },
      {
        "text": "Roll Phase",
        "children": [
          {
            "text": "The Roll Phase consists of two steps: the Selection Step and the Roll Step.",
            "children": []
          }
        ]
      },
      {
        "text": "Selection Step",
        "children": [
          {
            "text": "Starting with the Starting player, each player chooses an unopened Bakugan to roll and places it in front of them.",
            "children": [
              {
                "text": "If a player enters the Selection step with no closed Bakugan to choose, that player retracts all of their open Bakugan.",
                "children": []
              },
              {
                "text": "If for any reason, a player has no unopened Bakugan to select, that player must Retract each of their Bakugan and then select a Bakugan to roll.",
                "children": []
              }
            ]
          },
          {
            "text": "Players may play cards after selection and before the Roll Step.",
            "children": []
          }
        ]
      },
      {
        "text": "Rolling Step",
        "children": [
          {
            "text": "Prior to rolling the selected Bakugan, each player simultaneously says “Bakugan Brawl!” (or another agreed upon way to release simultaneously) and rolls their Bakugan towards the BakuCore Field.",
            "children": [
              {
                "text": "Bakugan can either be rolled end over end, slid or spun forward.",
                "children": []
              },
              {
                "text": "Bakugan must be released within two vertical card lengths from the edge of the table closest to the player rolling it.",
                "children": []
              },
              {
                "text": "Bakugan cannot be bounced or dropped onto or into the play area, it must stay on the play area surface.",
                "children": []
              },
              {
                "text": "Bakugan must come into contact with a BakuCore in order for an open to count.",
                "children": [
                  {
                    "text": "Contact with only the table, another Bakugan, card or other non-BakuCore element of the playing area counts as a non-open.",
                    "children": []
                  }
                ]
              }
            ]
          },
          {
            "text": "Each player that opens a rolled Bakugan reveals the corresponding face down Bakugan Character card and moves to the Brawl Phase.",
            "children": [
              {
                "text": "If neither Bakugan opened, start over from the beginning of the Roll Step.",
                "children": []
              },
              {
                "text": "If both Bakugan opened and are attached to the same BakuCore, both Characters get the BakuCore bonus.",
                "children": []
              },
              {
                "text": "If a Bakugan opens from contact with a BakuCore but does not stay attached to the BakuCore, the Bakugan is considered open but doesn’t receive the bonus from the BakuCore.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Brawl Phase",
        "children": [
          {
            "text": "The Brawl Phase consists of four steps: the Power step, Victor Step, Damage Step, and Retracting Step.",
            "children": []
          }
        ]
      },
      {
        "text": "Power Step",
        "children": [
          {
            "text": "Following priority rules (see rule 1.14), players may add to the batch (see rule 4.4) by playing cards and using abilities.",
            "children": []
          },
          {
            "text": "If BPower is tied during the Power Step and both players pass, then a BPower tie break takes place.",
            "children": [
              {
                "text": "In the case of a BPower tie break, the Victor is determined by both players flipping the top card of their deck into their discard pile. The player with the highest Energy cost card is the Victor. If the Energy costs are the same, repeat the process until a Victor is declared.",
                "children": [
                  {
                    "text": "If a player needs to flip the top card of their deck because of a BPower tie, but has no cards left in their deck, they lose the game.",
                    "children": [
                      {
                        "text": "If both players need to flip the top card of their deck because of a BPower tie with neither player having any cards in their deck, the game is a draw.",
                        "children": []
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "text": "Victor Step",
        "children": [
          {
            "text": "The start of the Victor Step begins when the Bakugan with the highest BPower, rolled from the Brawl Phase, is declared the Victor.",
            "children": [
              {
                "text": "",
                "children": []
              }
            ]
          },
          {
            "text": "All abilities that occur due to a Victor being declared enter the batch (see rule 4.4) in the order that the controller chooses.",
            "children": []
          },
          {
            "text": "Following priority rules (see rule 1.14), players may add to the batch by playing cards and using abilities.",
            "children": []
          }
        ]
      },
      {
        "text": "Damage Step",
        "children": [
          {
            "text": "Damage is dealt to the opposing player by flipping cards face up from the top of that player’s deck, one at a time. Cards flipped off the top of the deck are placed into the owner’s discard pile.",
            "children": []
          },
          {
            "text": "Players cannot play cards or use abilities while damage is being dealt, unless a Flip Card is both flipped and played by the Flip Card’s owner.",
            "children": [
              {
                "text": "If a Flip card is played, players can play cards and use abilities by following normal priority rules (see rule 1.14.)",
                "children": [
                  {
                    "text": "Opposing cards played in response to a Flip card that would modify the Victor Bakugan’s damage dealt have no effect.",
                    "children": []
                  }
                ]
              }
            ]
          },
          {
            "text": "Once damage has completed, following priority rules (see rule 1.14), players may add to the batch by playing cards and using abilities.",
            "children": []
          }
        ]
      },
      {
        "text": "Team Attack",
        "children": [
          {
            "text": "A team attack occurs when all Bakugan from one player’s team are opened, and that player won the Power Step for the turn.",
            "children": []
          },
          {
            "text": "To perform a team attack, combine the Damage Rating of all Bakugan from that player’s team. That number will be the Bakugan from this turns Brawl phase’s Damage Rating.",
            "children": [
              {
                "text": "Negative Damage Ratings from non-attacking Bakugan do not subtract from the attacking Bakugan’s Damage Rating.",
                "children": []
              },
              {
                "text": "BakuCores that grant additional Damage Rating to non-attacking Bakugan are part of those Bakugan’s Damage Rating and are included.",
                "children": []
              },
              {
                "text": "Abilities such as DoubleStrike and FrostStrike only apply to team attacks if the Victor Bakugan has these abilities.",
                "children": []
              }
            ]
          },
          {
            "text": "Once the attacking Bakugan has completed its attack, retract (see rule 5.13) all Bakugan that player controls.",
            "children": []
          }
        ]
      },
      {
        "text": "Retracting Step",
        "children": [
          {
            "text": "As soon as the retracting step begins, all Bakugan are removed from the Brawl Phase.",
            "children": []
          },
          {
            "text": "If the non-Victor player had a Bakugan involved in the Brawl Phase, that player retracts (see rule 7.2.5) that Bakugan and places all attached BakuCore’s back onto the BakuCore Field.",
            "children": []
          },
          {
            "text": "If the Victor player participated in a team attack during the Brawl Phase, that player retracts all Bakugan they control and places all BakuCores that were attached to them back onto the BakuCore Field.",
            "children": []
          }
        ]
      },
      {
        "text": "End Phase",
        "children": [
          {
            "text": "The End Phase consists of three steps: the play step, charge step, and reset step.",
            "children": []
          }
        ]
      },
      {
        "text": "Play Step",
        "children": [
          {
            "text": "Following priority rules (see rule 1.14), players may add to the batch (see rule 4.4) by playing cards and using abilities. This is the last instance of card plays and abilities that will happen during the turn.",
            "children": []
          }
        ]
      },
      {
        "text": "Charge Step",
        "children": [
          {
            "text": "During the charge step, both players charge all uncharged Energy cards they control (see rules 7.2.1 and 7.2.2).",
            "children": []
          }
        ]
      },
      {
        "text": "Reset Step",
        "children": [
          {
            "text": "During the reset step, all turn duration modifications to Bakugan are reset and they return to their base BPower, damage rating, and faction type.",
            "children": []
          }
        ]
      }
    ]
  },
  {
    "text": "Playing Cards, Abilities, and Effects",
    "children": [
      {
        "text": "General",
        "children": [
          {
            "text": "There are game actions that will cause a change in priority (see rule 1.14). Before priority is changed, the player taking any of these game actions may respond to their own effects. Once a player has added everything they wish to the batch, play passes to the non-acting player (see rule 7.6).",
            "children": []
          }
        ]
      },
      {
        "text": "Playing Cards",
        "children": [
          {
            "text": "To play a card is to pay its costs and move it from the hand and put it in the batch. A player must have priority to play a card.",
            "children": [
              {
                "text": "Playing a card requires the player with priority to announce the card and move it from where it is to the batch. It becomes the top card of the batch and will be the next effect to happen unless a player adds a card to the batch before it resolves. At the time the playing of a card is on the batch, it may be negated by an effect.",
                "children": []
              },
              {
                "text": "If the card has decisions within the effect, players make them upon announcing the playing of the card. This includes what the effect will be affecting.",
                "children": []
              },
              {
                "text": "Additional costs associated with the playing of a card must be paid and identified when the playing of the card is announced.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Triggered Abilities",
        "children": [
          {
            "text": "Triggered abilities are abilities that have specified conditions in which they occur. They typically appear as “When/if/at/other”, “condition”, “effect”.",
            "children": []
          },
          {
            "text": "If a Triggered ability has each of its conditions met, the result is put on the top of the batch. All rules that apply to the resolution of a card’s play effect in the batch (see 600.1) apply to a triggered ability in the batch.",
            "children": []
          },
          {
            "text": "If multiple triggered abilities would occur simultaneously, “the starting player” first places each of his or her abilities in the batch in the order he or she chooses. Then the other player places his or her abilities on top of the batch in the order he or she chooses.",
            "children": [
              {
                "text": "In the case of a game with 3+ players, “the starting player” first places each of his or her abilities in the batch in the order he or she chooses. This process then proceeds clockwise until all players with triggered abilities have placed their abilities in the batch.",
                "children": []
              }
            ]
          },
          {
            "text": "If a triggered ability is optional, the controller decides whether or not they put the ability in the batch.",
            "children": []
          },
          {
            "text": "Some triggered abilities have conditions under which their effect will happen. These conditions must be met when the ability resolves in order for the effect to take place.",
            "children": []
          }
        ]
      },
      {
        "text": "Activated Abilities",
        "children": [
          {
            "text": "Activated abilities have a cost and effect. They appear as “[cost]: [effect]”.",
            "children": []
          },
          {
            "text": "In order for an activated ability to be announced, all costs must be paid. Once costs are paid and the ability is announced, the effect is put on the top of the batch (see rule 4.4). All rules that apply to the resolution of a card’s play effect in the batch apply to an activated ability in the batch.",
            "children": []
          },
          {
            "text": "Some activated abilities have conditions under which their cost can be paid. These conditions must be met in order for the cost of an activated ability to be paid.",
            "children": []
          },
          {
            "text": "Some activated abilities have conditions under which their effect will happen. These conditions must be met when the ability resolves in order for the effect to take place.",
            "children": []
          }
        ]
      },
      {
        "text": "Static Abilities",
        "children": [
          {
            "text": "Static abilities take effect constantly rather than being activated or triggered at a particular time. They appear as statements on a card.",
            "children": []
          },
          {
            "text": "BakuCore effects are considered static abilities while they are held by a Character card.",
            "children": [
              {
                "text": "Some Characters have static abilities that are applied if they are holding a specific type of BakuCore. These appear as “(BakuCore Icon): (effect).”",
                "children": []
              }
            ]
          },
          {
            "text": "Static abilities can be active in a player’s hand, discard pile or the batch. These abilities will make statements about being in the zone they are active in. If there is no such statement, the ability only applies while in play.",
            "children": []
          }
        ]
      },
      {
        "text": "Energy Abilities",
        "children": [
          {
            "text": "Energy cards can be activated any time a player has priority. Using Energy cards to create Energy is called an Energy ability",
            "children": []
          },
          {
            "text": "Energy abilities are not put in the batch.",
            "children": []
          }
        ]
      },
      {
        "text": "Completing Effects",
        "children": [
          {
            "text": "Whenever there is an effect in the batch, if all players choose to not take any actions, the effect on top of the batch completes.",
            "children": [
              {
                "text": "Upon completion, all conditions of an effect must be met in order for the effect to take place.",
                "children": []
              },
              {
                "text": "Upon completion, all selections and choices of an effect must still be available and legal in order for it to take place.",
                "children": []
              },
              {
                "text": "Upon completion, the controller of an effect follows all instructions of the effect in the order the text is written.",
                "children": []
              },
              {
                "text": "Upon completion, some effects will have choices for a player to make. These choices are made in order for the effect to take place.",
                "children": []
              },
              {
                "text": "Upon completion, if an effect needs to check the state of the game, it checks once at the moment of completion.",
                "children": []
              },
              {
                "text": "If the above (605.1a - 605.1e) are all met and decided, the effect leaves the batch and takes place.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Effects",
        "children": [
          {
            "text": "An effect is defined as anything that happens in the game that is a result of playing a card or using an ability.",
            "children": []
          },
          {
            "text": "Effects are assumed to apply to Character cards unless otherwise stated in the text.",
            "children": []
          },
          {
            "text": "If an effect exceeds possibilities, it only does as much as possible.",
            "children": []
          }
        ]
      },
      {
        "text": "Continuous Effects",
        "children": [
          {
            "text": "Continuous effects modify something for as long as they are active. They read as statements in text.",
            "children": []
          },
          {
            "text": "Once a continuous effect is in play, it is treated as a true statement and can no longer be responded to.",
            "children": []
          }
        ]
      },
      {
        "text": "Negate Effects",
        "children": [
          {
            "text": "Negate effects appear as [“negate” an “object/event”].",
            "children": []
          },
          {
            "text": "Negate effects remove effects from the batch.",
            "children": [
              {
                "text": "When a card or ability is removed from the batch, the effects of that card do not happen.",
                "children": []
              },
              {
                "text": "The card that created the negated effect goes to the discard pile in the case of an action.",
                "children": []
              },
              {
                "text": "A BakuCore that is negated is returned to the BakuCore Field (see rule 4.7).",
                "children": []
              },
              {
                "text": "An effect that was created by a card in play is removed from the batch but the card that created the effect remains in play.",
                "children": []
              }
            ]
          },
          {
            "text": "Action cards that have Negate effects enter the batch and resolve on the batch like any other Action card effect, and therefore, may be Negated by cards that Negate Action card effects.",
            "children": []
          }
        ]
      }
    ]
  },
  {
    "text": "Additional Rules",
    "children": [
      {
        "text": "General",
        "children": [
          {
            "text": "7.1.1.",
            "children": []
          }
        ]
      },
      {
        "text": "Gameplay Terms",
        "children": [
          {
            "text": "Charge",
            "children": [
              {
                "text": "Charge, charged, and charging refer to vertical Energy cards. At the end of the turn, all Energy cards become charged.",
                "children": []
              }
            ]
          },
          {
            "text": "Uncharge",
            "children": [
              {
                "text": "Uncharge, uncharged, and uncharging refer to horizontal Energy cards. Uncharging an Energy card produces energy (see rule 1.7.).",
                "children": []
              }
            ]
          },
          {
            "text": "Spend",
            "children": [
              {
                "text": "Spend refers to the action being made when uncharging a charged Energy card. To spend an Energy card, turn it from vertical to horizontal. This action produces an energy that can be used to play cards.",
                "children": []
              }
            ]
          },
          {
            "text": "Energize",
            "children": [
              {
                "text": "Energize refers to taking a card from a zone and putting it into play as an Energy card.",
                "children": []
              }
            ]
          },
          {
            "text": "Retract",
            "children": [
              {
                "text": "Retract refers to returning an open Bakugan to its closed form and placing (see rule 4.7) back any BakuCores it may be holding.",
                "children": []
              }
            ]
          },
          {
            "text": "Open",
            "children": [
              {
                "text": "Open Bakugan are any Bakugan that opened during the Roll phase (see rule 5.5). In addition, Bakugan that have previously won a Bakugan Brawl, but have not yet been retracted from abilities or the Team Attack (see rule 5.12), are also open.",
                "children": []
              },
              {
                "text": "A Bakugan does not need to have a BakuCore attached to it in order to be considered open, but must open as a result of the magnet portion of the Bakugan hitting a BakuCore. If an illegal roll has been made, that roll is considered missed (see rule 5.7 for legal roles).",
                "children": []
              }
            ]
          },
          {
            "text": "Trigger",
            "children": [
              {
                "text": "Triggers can result from any of the following events: a card being played, another ability being triggered or activated, starting a new phase or step, and ending a new phase or step.",
                "children": []
              },
              {
                "text": "When a trigger occurs, it enters the batch (see rule 4.4).",
                "children": []
              }
            ]
          },
          {
            "text": "Flip",
            "children": [
              {
                "text": "Cards that are flipped are turned face up, one at a time, from the top of a player’s deck.",
                "children": []
              }
            ]
          },
          {
            "text": "Stop",
            "children": [
              {
                "text": "A stop will end all remaining damage from the damage origin (see rule 1.15.1.).",
                "children": []
              }
            ]
          },
          {
            "text": "Victor",
            "children": [
              {
                "text": "The Victor is decided each turn during the Victor step (see rule 5.10), when the Bakugan with the highest BPower is declared.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Keyword Abilities",
        "children": [
          {
            "text": "(DoubleStrike) DoubleStrike",
            "children": [
              {
                "text": "A Bakugan with (DoubleStrike) deals twice the amount of damage based on its (DR) all at once when it attacks.",
                "children": [
                  {
                    "text": "Example - If a Bakugan has 5(DR) and has (DoubleStrike), it will deal 10 damage when it attacks its opponent.",
                    "children": []
                  }
                ]
              },
              {
                "text": "When a Brawl Phase’s outcome is decided by (DR) instead of (BP), count the Bakugan’s (DR) amount, and not the (DoubleStrike) damage.",
                "children": []
              }
            ]
          },
          {
            "text": "(ShadowStrike) ShadowStrike",
            "children": [
              {
                "text": "Bakugan with (ShadowStrike) can't have its (DR) or (BP) reduced by cards or BakuCores.",
                "children": [
                  {
                    "text": "Example - If a Bakugan with (ShadowStrike) is the Victor of the Brawl Phase and they are attacked to a BakuCore that gives -2 (DR), the BakuCore is ignored.",
                    "children": []
                  }
                ]
              },
              {
                "text": "When a Bakugan gains (ShadowStrike), it reverts any effects that reduced its (DR) or (BP) that turn.",
                "children": []
              }
            ]
          },
          {
            "text": "(FrostStrike) FrostStrike",
            "children": [
              {
                "text": "Bakugan with (FrostStrike) increases the Energy an opponent must play for Flip card. The amount of Energy that the opponent must pay extra is equal to the amount of FrostStrike the Attacking Bakugan has.",
                "children": [
                  {
                    "text": "Example - If an attacking Bakugan has 1(FrostStrike) and the opponent wants to play any Flip cards from the Bakugan's damage, they will have to pay an additional 1(Energy) to do so.",
                    "children": []
                  }
                ]
              },
              {
                "text": "If the attacking Bakugan gains any amount of (FrostStrike) in response to a Flip card being played, it does not retroactively affect Flip card costs that turn.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Tag-Word Abilities",
        "children": [
          {
            "text": "Turbo",
            "children": [
              {
                "text": "Cards with Turbo get their bonus effects if the player playing the card has more Energy cards in play than any opponent when the Turbo effect resolves.",
                "children": []
              }
            ]
          },
          {
            "text": "Flow",
            "children": [
              {
                "text": "Cards with Flow get their bonus effects if the card with Flow isn’t the first card that the controller has played that turn.",
                "children": []
              }
            ]
          },
          {
            "text": "Fury",
            "children": [
              {
                "text": "Cards with Fury get their bonus effects if the player playing the card has no cards in hand when the Fury effect resolves.",
                "children": []
              }
            ]
          },
          {
            "text": "Sacrifice",
            "children": [
              {
                "text": "Cards with Sacrifice get their bonus effects if the player playing the card discards a card from their hand as the Sacrifice effect resolves.",
                "children": []
              }
            ]
          },
          {
            "text": "Domination",
            "children": [
              {
                "text": "Cards with Domination get their bonus effects if the player playing the card has more BakuCores connected to their Bakugan than any opponent when the Domination effect resolves.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Starting Player",
        "children": [
          {
            "text": "Determining the starting player at the start of the game is accomplished by flipping a BakuCore. One player flips a BakuCore edge over edge, while the other player calls either “heads”, the BakuCore’s symbol, or “tails”, the BakuCore’s text. If predicted correctly, that player wins the toss and becomes the starting player for the game.",
            "children": []
          }
        ]
      },
      {
        "text": "Acting Player",
        "children": [
          {
            "text": "The acting player is the player who has priority (see rule 1.13). Once that player passes priority, the non-acting player then becomes the acting player.",
            "children": []
          }
        ]
      },
      {
        "text": "Copying Cards and Abilities",
        "children": [
          {
            "text": "When a card or ability copies another card or ability’s effect, treat it as if it had been played independently.",
            "children": []
          },
          {
            "text": "Copied cards do not have the modified abilities granted to the original card.",
            "children": []
          },
          {
            "text": "If the original card or ability that was copied is negated, it does not negate its copies.",
            "children": []
          },
          {
            "text": "Copied cards and abilities must be played immediately, or it is lost.",
            "children": []
          }
        ]
      },
      {
        "text": "Illegal Actions",
        "children": [
          {
            "text": "Illegal Card Plays",
            "children": [
              {
                "text": "When a player plays a card that they could not pay the Energy cost for, or are prevented from playing it, it is an illegal card play.",
                "children": []
              },
              {
                "text": "Illegal card plays are negated and any effects are reversed.",
                "children": []
              },
              {
                "text": "Illegally played cards are returned to its owner’s hand and any Energy used to pay for it returns to that player’s Energy Pool.",
                "children": []
              },
              {
                "text": "Illegally played cards returned to their owner’s hand may still be played legally.",
                "children": []
              }
            ]
          },
          {
            "text": "Illegal Bakugan Plays",
            "children": [
              {
                "text": "When a Bakugan is rolled closer than two card lengths from the edge of the closest BakuCore in the BakuCore Field, it is an illegal Bakugan roll.",
                "children": []
              },
              {
                "text": "When a Bakugan is bounced or dropped onto or into the play area instead of rolled on the surface of the play area, it is an illegal Bakugan roll.",
                "children": []
              },
              {
                "text": "When a Bakugan opens without contacting a BakuCore, it is an illegal roll.",
                "children": []
              },
              {
                "text": "When an open Bakugan that had not been retracted is rolled, it is an illegal Bakugan roll.",
                "children": []
              },
              {
                "text": "Any BakuCores picked up during an illegal roll are returned to their original place in the BakuCore Field and any BakuCore bonuses are negated.",
                "children": []
              },
              {
                "text": "Bakugan rolled illegally are reset to their previous position, either open or closed.",
                "children": []
              },
              {
                "text": "A new roll can be made with returned Bakugan if it can be rolled legally.",
                "children": []
              }
            ]
          }
        ]
      },
      {
        "text": "Handling Mis-rolls",
        "children": [
          {
            "text": "If a rolled Bakugan rolls off the play area, or does not enter the play area, it is a mis-roll.",
            "children": []
          },
          {
            "text": "Mis-rolls are treated as a roll that did not result in the Bakugan opening. .",
            "children": []
          }
        ]
      },
      {
        "text": "Taking Control of a Card",
        "children": [
          {
            "text": "When control of a card is moved from one player to another, that player is now the controller of that card.",
            "children": []
          },
          {
            "text": "When a controlled card is discarded from play, it is placed in its original owner’s discard pile.",
            "children": []
          }
        ]
      }
    ]
  },
  {
    "text": "Multiplayer Rules",
    "children": [
      {
        "text": "General",
        "children": [
          {
            "text": "Multiplayer rules follow the full version of the Bakugan game, with some modifications.",
            "children": []
          }
        ]
      },
      {
        "text": "Modifications",
        "children": [
          {
            "text": "Priority rules remain the same (see rule 1.13) but pass in a clockwise direction.",
            "children": []
          },
          {
            "text": "In the case that the starting player (see rule 7.5) is not part of the Bakugan Brawl, the player closest to the starting player, going clockwise, wins ties.",
            "children": []
          },
          {
            "text": "The Victor deals damage to each other player, rather than just one player.",
            "children": []
          },
          {
            "text": "When a player has no cards remaining in their deck and is dealt damage, that player is eliminated from the game, but the game does not end until there is only one remaining player.",
            "children": []
          }
        ]
      }
    ]
  },
  {
    "text": "Cardless Rules (basic game)",
    "children": [
      {
        "text": "General",
        "children": [
          {
            "text": "The basic game is played only using Bakugan along with their corresponding Character cards, and BakuCores that match the BakuCore indicators on those Character cards.",
            "children": []
          }
        ]
      },
      {
        "text": "Setup",
        "children": [
          {
            "text": "Each player must have three Bakugan toys along with their appropriate Character cards.",
            "children": []
          },
          {
            "text": "Player’s pick six BakuCores that match the BakuCore indicators of the Bakugan they have selected.",
            "children": []
          },
          {
            "text": "Randomly determine who will be the starting player and who will be the non-starting player. During each phase of the game where players must make a decision, the starting player will be the player to act first and the non-starting player will act last.",
            "children": []
          }
        ]
      },
      {
        "text": "Roll Phase",
        "children": [
          {
            "text": "The Roll Phase consists of two steps: the Selection Step and the Rolling Step. During this phase, players cannot play cards or use abilities.",
            "children": []
          },
          {
            "text": "Bakugan can either be rolled end over end, slid or spun forward.",
            "children": []
          },
          {
            "text": "Bakugan must be rolled at least 2 card lengths from the edge of the closest BakuCore in the BakuCore Field.",
            "children": []
          },
          {
            "text": "Bakugan cannot be bounced or dropped onto or into the play area, it must stay on the play area surface.",
            "children": []
          },
          {
            "text": "If after three rolls, neither Bakugan open, start the Brawl Phase as if both Bakugan opened without collecting a BakuCore.",
            "children": []
          }
        ]
      },
      {
        "text": "Selection Step",
        "children": [
          {
            "text": "Starting with the starting player, each player chooses an unopened (see rule 7.2.6) Bakugan to roll and places it in front of them.",
            "children": []
          }
        ]
      },
      {
        "text": "Rolling Step",
        "children": [
          {
            "text": "Prior to rolling the selected Bakugan, each player simultaneously says “Bakugan Brawl!” and rolls their Bakugan towards the BakuCore Field.",
            "children": []
          },
          {
            "text": "Each player that opened (see rule 7.2.6) a rolled Bakugan reveals their face down Bakugan Character card and moves to the Brawl Phase. If neither Bakugan opened, start over from the beginning of the Roll Step.",
            "children": []
          }
        ]
      },
      {
        "text": "Brawl Phase",
        "children": [
          {
            "text": "Each Bakugan that is part of the Brawl phase gains any BakuCore abilities from the BakuCores it picked up.",
            "children": []
          },
          {
            "text": "Compare BPower to see who has the higher BPower and wins the Bakugan Brawl. In the case of a tie, the winner is the starting player.",
            "children": []
          },
          {
            "text": "Collect all BakuCores from the winning Bakugan and put them next to that Bakugan’s Character card.",
            "children": [
              {
                "text": "If the winning players Bakugan did not pick up a BakuCore when it opened, that player selects one from the BakuCore Field and put it next to that Bakugan’s Character card.",
                "children": []
              }
            ]
          },
          {
            "text": "Players retract (see rule 7.2.5) losing Bakugan and place back any BakuCores they were holding back on the BakuCore Field (see rule 4.7).",
            "children": []
          }
        ]
      },
      {
        "text": "Winning",
        "children": [
          {
            "text": "Once a player has collected three BakuCores, that player is declared the winner.",
            "children": []
          }
        ]
      }
    ]
  }
];
