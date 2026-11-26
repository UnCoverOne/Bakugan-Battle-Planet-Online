import assert from "node:assert/strict";
import test from "node:test";
import {lobbyRouteDecision,shouldEnterStartedSeries} from "../lib/lobby-client-routing";

test("Play routes resolve verified membership; unknown is not absence",()=>{
  assert.equal(lobbyRouteDecision("/play","checking",false,false),"block");
  assert.equal(lobbyRouteDecision("/play","unavailable",true,false),"block");
  assert.equal(lobbyRouteDecision("/play","identity-conflict",false,false),"block");
  assert.equal(lobbyRouteDecision("/play","none",false,false),"allow");
  assert.equal(lobbyRouteDecision("/play","identity-required",false,false),"allow");
  assert.equal(lobbyRouteDecision("/play","member",true,true),"/play/lobby");
  assert.equal(lobbyRouteDecision("/play/lobby","member",true,true),"allow");
  assert.equal(lobbyRouteDecision("/play/match","member",true,true),"allow");
  assert.equal(lobbyRouteDecision("/play/match","member",true,false),"/play/lobby");
  assert.equal(lobbyRouteDecision("/play/lobby","none",false,false),"/play");
  assert.equal(lobbyRouteDecision("/decks","unavailable",true,true),"allow");
});
test("only an observed idle-to-active transition on the preparation page launches gameplay",()=>{
  const idle={lobbyId:"a",seriesId:null},active={lobbyId:"a",seriesId:"one"};
  assert.equal(shouldEnterStartedSeries("/play/lobby",idle,active),true);
  assert.equal(shouldEnterStartedSeries("/decks",idle,active),false);
  assert.equal(shouldEnterStartedSeries("/play/lobby",null,active),false);
  assert.equal(shouldEnterStartedSeries("/play/lobby",active,active),false);
  assert.equal(shouldEnterStartedSeries("/play/lobby",idle,{...active,lobbyId:"b"}),false);
});
