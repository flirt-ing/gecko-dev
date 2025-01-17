/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  getAllMessagesUiById,
  getAllCssMessagesMatchingElements,
  getAllNetworkMessagesUpdateById,
  getAllRepeatById,
  getCurrentGroup,
  getGroupsById,
  getMutableMessagesById,
  getVisibleMessages,
} = require("resource://devtools/client/webconsole/selectors/messages.js");
const {
  getFirstMessage,
  getLastMessage,
  getPrivatePacket,
  getWebConsoleUiMock,
  setupActions,
  setupStore,
} = require("resource://devtools/client/webconsole/test/node/helpers.js");
const {
  stubPackets,
} = require("resource://devtools/client/webconsole/test/node/fixtures/stubs/index.js");
const {
  CSS_MESSAGE_ADD_MATCHING_ELEMENTS,
} = require("resource://devtools/client/webconsole/constants.js");

const expect = require("expect");

describe("private messages", () => {
  let actions;
  beforeAll(() => {
    actions = setupActions();
  });

  it("removes private messages on PRIVATE_MESSAGES_CLEAR action", () => {
    const { dispatch, getState } = setupStore();

    dispatch(
      actions.messagesAdd([
        getPrivatePacket("console.trace()"),
        stubPackets.get("console.log('mymap')"),
        getPrivatePacket("console.log(undefined)"),
        getPrivatePacket("GET request"),
      ])
    );

    let state = getState();
    const messages = getMutableMessagesById(state);
    expect(messages.size).toBe(4);

    dispatch(actions.privateMessagesClear());

    state = getState();
    expect(getMutableMessagesById(state).size).toBe(1);
    expect(getVisibleMessages(state).length).toBe(1);
  });

  it("cleans messagesUiById on PRIVATE_MESSAGES_CLEAR action", () => {
    const { dispatch, getState } = setupStore();

    dispatch(
      actions.messagesAdd([
        getPrivatePacket("console.trace()"),
        stubPackets.get("console.trace()"),
      ])
    );

    let state = getState();
    expect(getAllMessagesUiById(state).length).toBe(2);

    dispatch(actions.privateMessagesClear());

    state = getState();
    expect(getAllMessagesUiById(state).length).toBe(1);
  });

  it("cleans repeatsById on PRIVATE_MESSAGES_CLEAR action", () => {
    const { dispatch, getState } = setupStore();

    dispatch(
      actions.messagesAdd([
        getPrivatePacket("console.log(undefined)"),
        getPrivatePacket("console.log(undefined)"),
        stubPackets.get("console.log(undefined)"),
        stubPackets.get("console.log(undefined)"),
      ])
    );

    let state = getState();
    expect(getAllRepeatById(state)).toEqual({
      [getFirstMessage(state).id]: 2,
      [getLastMessage(state).id]: 2,
    });

    dispatch(actions.privateMessagesClear());

    state = getState();
    expect(Object.keys(getAllRepeatById(state)).length).toBe(1);
    expect(getAllRepeatById(state)).toEqual({
      [getFirstMessage(state).id]: 2,
    });
  });

  it("cleans cssMessagesMatchingElements on PRIVATE_MESSAGES_CLEAR action", () => {
    const { dispatch, getState } = setupStore();

    dispatch(
      actions.messagesAdd([
        getPrivatePacket(
          `Unknown property ‘such-unknown-property’.  Declaration dropped.`
        ),
        stubPackets.get(
          `Error in parsing value for ‘padding-top’.  Declaration dropped.`
        ),
      ])
    );

    const privateData = Symbol("privateData");
    const publicData = Symbol("publicData");

    dispatch({
      type: CSS_MESSAGE_ADD_MATCHING_ELEMENTS,
      id: getFirstMessage(getState()).id,
      elements: privateData,
    });

    dispatch({
      type: CSS_MESSAGE_ADD_MATCHING_ELEMENTS,
      id: getLastMessage(getState()).id,
      elements: publicData,
    });

    let state = getState();
    expect(getAllCssMessagesMatchingElements(state).size).toBe(2);

    dispatch(actions.privateMessagesClear());

    state = getState();
    expect(getAllCssMessagesMatchingElements(state).size).toBe(1);
    expect(
      getAllCssMessagesMatchingElements(state).get(
        getFirstMessage(getState()).id
      )
    ).toBe(publicData);
  });

  it("cleans group properties on PRIVATE_MESSAGES_CLEAR action", () => {
    const { dispatch, getState } = setupStore();
    dispatch(
      actions.messagesAdd([
        stubPackets.get("console.group()"),
        getPrivatePacket("console.group()"),
      ])
    );

    let state = getState();
    const publicMessageId = getFirstMessage(state).id;
    const privateMessageId = getLastMessage(state).id;
    expect(getCurrentGroup(state)).toBe(privateMessageId);
    expect(getGroupsById(state).size).toBe(2);

    dispatch(actions.privateMessagesClear());

    state = getState();
    expect(getGroupsById(state).size).toBe(1);
    expect(getGroupsById(state).has(publicMessageId)).toBe(true);
    expect(getCurrentGroup(state)).toBe(publicMessageId);
  });

  it("cleans networkMessagesUpdateById on PRIVATE_MESSAGES_CLEAR action", () => {
    const { dispatch, getState } = setupStore();

    const publicActor = "network/public";
    const privateActor = "network/private";
    const publicPacket = {
      ...stubPackets.get("GET request"),
      actor: publicActor,
    };
    const privatePacket = {
      ...getPrivatePacket("XHR GET request"),
      actor: privateActor,
    };

    // We need to reassign the timeStamp of the packet to guarantee the order.
    publicPacket.timeStamp = publicPacket.timeStamp + 1;
    privatePacket.timeStamp = privatePacket.timeStamp + 2;

    dispatch(actions.messagesAdd([publicPacket, privatePacket]));

    let networkUpdates = getAllNetworkMessagesUpdateById(getState());
    expect(Object.keys(networkUpdates)).toEqual([publicActor, privateActor]);

    dispatch(actions.privateMessagesClear());

    networkUpdates = getAllNetworkMessagesUpdateById(getState());
    expect(Object.keys(networkUpdates)).toEqual([publicActor]);
  });

  it("releases private backend actors on PRIVATE_MESSAGES_CLEAR action", () => {
    const releasedActors = [];
    const { dispatch, getState } = setupStore([], {
      webConsoleUI: getWebConsoleUiMock({
        commands: {
          client: {
            mainRoot: {
              supportsReleaseActors: true,
            },
          },
          objectCommand: {
            releaseObjects: async frontsToRelease => {
              for (const front of frontsToRelease) {
                releasedActors.push(front.actorID);
              }
            },
          },
        },
      }),
    });
    const mockFrontRelease = function () {
      releasedActors.push(this.actorID);
    };

    const publicPacket = stubPackets.get(
      "console.log('myarray', ['red', 'green', 'blue'])"
    );
    const privatePacket = getPrivatePacket("console.log('mymap')");

    publicPacket.message.arguments[1].release = mockFrontRelease;
    privatePacket.message.arguments[1].release = mockFrontRelease;

    // Add a log message.
    dispatch(actions.messagesAdd([publicPacket, privatePacket]));

    const firstMessage = getFirstMessage(getState());
    const firstMessageActor = firstMessage.parameters[1].actorID;

    const lastMessage = getLastMessage(getState());
    const lastMessageActor = lastMessage.parameters[1].actorID;

    // Kick-off the actor release.
    dispatch(actions.privateMessagesClear());

    expect(releasedActors.length).toBe(1);
    expect(releasedActors).toInclude(lastMessageActor);
    expect(releasedActors).toNotInclude(firstMessageActor);
  });
});
