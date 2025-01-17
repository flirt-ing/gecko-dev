/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  classMap,
  html,
  map,
  when,
} from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import {
  getLogger,
  isSearchEnabled,
  placeLinkOnClipboard,
  searchTabList,
  MAX_TABS_FOR_RECENT_BROWSING,
} from "./helpers.mjs";
import { ViewPage, ViewPageContent } from "./viewpage.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ContextualIdentityService:
    "resource://gre/modules/ContextualIdentityService.sys.mjs",
  NonPrivateTabs: "resource:///modules/OpenTabs.sys.mjs",
  getTabsTargetForWindow: "resource:///modules/OpenTabs.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "fxAccounts", () => {
  return ChromeUtils.importESModule(
    "resource://gre/modules/FxAccounts.sys.mjs"
  ).getFxAccountsSingleton();
});

/**
 * A collection of open tabs grouped by window.
 *
 * @property {Array<Window>} windows
 *   A list of windows with the same privateness
 */
class OpenTabsInView extends ViewPage {
  static properties = {
    ...ViewPage.properties,
    windows: { type: Array },
    searchQuery: { type: String },
  };
  static queries = {
    viewCards: { all: "view-opentabs-card" },
    searchTextbox: "fxview-search-textbox",
  };

  initialWindowsReady = false;
  currentWindow = null;
  openTabsTarget = null;

  constructor() {
    super();
    this._started = false;
    this.windows = [];
    this.currentWindow = this.getWindow();
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(this.currentWindow)) {
      this.openTabsTarget = lazy.getTabsTargetForWindow(this.currentWindow);
    } else {
      this.openTabsTarget = lazy.NonPrivateTabs;
    }
    this.searchQuery = "";
  }

  start() {
    if (this._started) {
      return;
    }
    this._started = true;

    if (this.recentBrowsing) {
      this.openTabsTarget.addEventListener("TabRecencyChange", this);
    } else {
      this.openTabsTarget.addEventListener("TabChange", this);
    }

    // To resolve the race between this component wanting to render all the windows'
    // tabs, while those windows are still potentially opening, flip this property
    // once the promise resolves and we'll bail out of rendering until then.
    this.openTabsTarget.readyWindowsPromise.finally(() => {
      this.initialWindowsReady = true;
      this._updateWindowList();
    });

    for (let card of this.viewCards) {
      card.paused = false;
      card.viewVisibleCallback?.();
    }

    if (this.recentBrowsing) {
      this.recentBrowsingElement.addEventListener(
        "fxview-search-textbox-query",
        this
      );
    }
  }

  shouldUpdate(changedProperties) {
    if (!this.initialWindowsReady) {
      return false;
    }
    return super.shouldUpdate(changedProperties);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stop();
  }

  stop() {
    if (!this._started) {
      return;
    }
    this._started = false;
    this.paused = true;

    this.openTabsTarget.removeEventListener("TabChange", this);
    this.openTabsTarget.removeEventListener("TabRecencyChange", this);

    for (let card of this.viewCards) {
      card.paused = true;
      card.viewHiddenCallback?.();
    }

    if (this.recentBrowsing) {
      this.recentBrowsingElement.removeEventListener(
        "fxview-search-textbox-query",
        this
      );
    }
  }

  viewVisibleCallback() {
    this.start();
  }

  viewHiddenCallback() {
    this.stop();
  }

  render() {
    if (this.recentBrowsing) {
      return this.getRecentBrowsingTemplate();
    }
    let currentWindowIndex, currentWindowTabs;
    let index = 1;
    const otherWindows = [];
    this.windows.forEach(win => {
      const tabs = this.openTabsTarget.getTabsForWindow(win);
      if (win === this.currentWindow) {
        currentWindowIndex = index++;
        currentWindowTabs = tabs;
      } else {
        otherWindows.push([index++, tabs, win]);
      }
    });

    const cardClasses = classMap({
      "height-limited": this.windows.length > 3,
      "width-limited": this.windows.length > 1,
    });
    let cardCount;
    if (this.windows.length <= 1) {
      cardCount = "one";
    } else if (this.windows.length === 2) {
      cardCount = "two";
    } else {
      cardCount = "three-or-more";
    }
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/firefoxview/view-opentabs.css"
      />
      <link
        rel="stylesheet"
        href="chrome://browser/content/firefoxview/firefoxview.css"
      />
      <div class="sticky-container bottom-fade">
        <h2
          class="page-header heading-large"
          data-l10n-id="firefoxview-opentabs-header"
        ></h2>
        ${when(
          isSearchEnabled(),
          () => html`<div>
            <fxview-search-textbox
              data-l10n-id="firefoxview-search-text-box-opentabs"
              data-l10n-attrs="placeholder"
              @fxview-search-textbox-query=${this.onSearchQuery}
              .size=${this.searchTextboxSize}
              pageName=${this.recentBrowsing ? "recentbrowsing" : "opentabs"}
            ></fxview-search-textbox>
          </div>`
        )}
      </div>
      <div
        card-count=${cardCount}
        class="view-opentabs-card-container cards-container"
      >
        ${when(
          currentWindowIndex && currentWindowTabs,
          () =>
            html`
              <view-opentabs-card
                class=${cardClasses}
                .tabs=${currentWindowTabs}
                .paused=${this.paused}
                data-inner-id="${this.currentWindow.windowGlobalChild
                  .innerWindowId}"
                data-l10n-id="firefoxview-opentabs-current-window-header"
                data-l10n-args="${JSON.stringify({
                  winID: currentWindowIndex,
                })}"
                .searchQuery=${this.searchQuery}
              ></view-opentabs-card>
            `
        )}
        ${map(
          otherWindows,
          ([winID, tabs, win]) => html`
            <view-opentabs-card
              class=${cardClasses}
              .tabs=${tabs}
              .paused=${this.paused}
              data-inner-id="${win.windowGlobalChild.innerWindowId}"
              data-l10n-id="firefoxview-opentabs-window-header"
              data-l10n-args="${JSON.stringify({ winID })}"
              .searchQuery=${this.searchQuery}
            ></view-opentabs-card>
          `
        )}
      </div>
    `;
  }

  onSearchQuery(e) {
    this.searchQuery = e.detail.query;
  }

  /**
   * Render a template for the 'Recent browsing' page, which shows a shorter list of
   * open tabs in the current window.
   *
   * @returns {TemplateResult}
   *   The recent browsing template.
   */
  getRecentBrowsingTemplate() {
    const tabs = this.openTabsTarget.getRecentTabs();
    return html`<view-opentabs-card
      .tabs=${tabs}
      .recentBrowsing=${true}
      .paused=${this.paused}
      .searchQuery=${this.searchQuery}
    ></view-opentabs-card>`;
  }

  handleEvent({ detail, target, type }) {
    if (this.recentBrowsing && type === "fxview-search-textbox-query") {
      this.onSearchQuery({ detail });
      return;
    }
    let windowIds;
    switch (type) {
      case "TabRecencyChange":
      case "TabChange":
        // if we're switching away from our tab, we can halt any updates immediately
        if (!this.isSelectedBrowserTab) {
          this.stop();
          return;
        }
        windowIds = detail.windowIds;
        this._updateWindowList();
        break;
    }
    if (this.recentBrowsing) {
      return;
    }
    if (windowIds?.length) {
      // there were tab changes to one or more windows
      for (let winId of windowIds) {
        const cardForWin = this.shadowRoot.querySelector(
          `view-opentabs-card[data-inner-id="${winId}"]`
        );
        if (this.searchQuery) {
          cardForWin?.updateSearchResults();
        }
        cardForWin?.requestUpdate();
      }
    } else {
      let winId = window.windowGlobalChild.innerWindowId;
      let cardForWin = this.shadowRoot.querySelector(
        `view-opentabs-card[data-inner-id="${winId}"]`
      );
      if (this.searchQuery) {
        cardForWin?.updateSearchResults();
      }
    }
  }

  async _updateWindowList() {
    this.windows = this.openTabsTarget.currentWindows;
  }
}
customElements.define("view-opentabs", OpenTabsInView);

/**
 * A card which displays a list of open tabs for a window.
 *
 * @property {boolean} showMore
 *   Whether to force all tabs to be shown, regardless of available space.
 * @property {MozTabbrowserTab[]} tabs
 *   The open tabs to show.
 * @property {string} title
 *   The window title.
 */
class OpenTabsInViewCard extends ViewPageContent {
  static properties = {
    showMore: { type: Boolean },
    tabs: { type: Array },
    title: { type: String },
    recentBrowsing: { type: Boolean },
    searchQuery: { type: String },
    searchResults: { type: Array },
    showAll: { type: Boolean },
    cumulativeSearches: { type: Number },
  };
  static MAX_TABS_FOR_COMPACT_HEIGHT = 7;

  constructor() {
    super();
    this.showMore = false;
    this.tabs = [];
    this.title = "";
    this.recentBrowsing = false;
    this.devices = [];
    this.searchQuery = "";
    this.searchResults = null;
    this.showAll = false;
    this.cumulativeSearches = 0;
  }

  static queries = {
    cardEl: "card-container",
    tabContextMenu: "view-opentabs-contextmenu",
    tabList: "fxview-tab-list",
  };

  openContextMenu(e) {
    let { originalEvent } = e.detail;
    this.tabContextMenu.toggle({
      triggerNode: e.originalTarget,
      originalEvent,
    });
  }

  getMaxTabsLength() {
    if (this.recentBrowsing && !this.showAll) {
      return MAX_TABS_FOR_RECENT_BROWSING;
    } else if (this.classList.contains("height-limited") && !this.showMore) {
      return OpenTabsInViewCard.MAX_TABS_FOR_COMPACT_HEIGHT;
    }
    return -1;
  }

  isShowAllLinkVisible() {
    return (
      this.recentBrowsing &&
      this.searchQuery &&
      this.searchResults.length > MAX_TABS_FOR_RECENT_BROWSING &&
      !this.showAll
    );
  }

  toggleShowMore(event) {
    if (
      event.type == "click" ||
      (event.type == "keydown" && event.code == "Enter") ||
      (event.type == "keydown" && event.code == "Space")
    ) {
      event.preventDefault();
      this.showMore = !this.showMore;
    }
  }

  enableShowAll(event) {
    if (
      event.type == "click" ||
      (event.type == "keydown" && event.code == "Enter") ||
      (event.type == "keydown" && event.code == "Space")
    ) {
      event.preventDefault();
      Services.telemetry.recordEvent(
        "firefoxview_next",
        "search_show_all",
        "showallbutton",
        null,
        {
          section: "opentabs",
        }
      );
      this.showAll = true;
    }
  }

  onTabListRowClick(event) {
    const tab = event.originalTarget.tabElement;
    const browserWindow = tab.ownerGlobal;
    browserWindow.focus();
    browserWindow.gBrowser.selectedTab = tab;

    Services.telemetry.recordEvent(
      "firefoxview_next",
      "open_tab",
      "tabs",
      null,
      {
        page: this.recentBrowsing ? "recentbrowsing" : "opentabs",
        window: this.title || "Window 1 (Current)",
      }
    );
    if (this.searchQuery) {
      const searchesHistogram = Services.telemetry.getKeyedHistogramById(
        "FIREFOX_VIEW_CUMULATIVE_SEARCHES"
      );
      searchesHistogram.add(
        this.recentBrowsing ? "recentbrowsing" : "opentabs",
        this.cumulativeSearches
      );
      this.cumulativeSearches = 0;
    }
  }

  viewVisibleCallback() {
    this.getRootNode().host.toggleVisibilityInCardContainer(true);
  }

  viewHiddenCallback() {
    this.getRootNode().host.toggleVisibilityInCardContainer(true);
  }

  firstUpdated() {
    this.getRootNode().host.toggleVisibilityInCardContainer(true);
  }

  render() {
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/firefoxview/firefoxview.css"
      />
      <card-container
        ?preserveCollapseState=${this.recentBrowsing}
        shortPageName=${this.recentBrowsing ? "opentabs" : null}
        ?showViewAll=${this.recentBrowsing}
      >
        ${when(
          this.recentBrowsing,
          () => html`<h3
            slot="header"
            data-l10n-id="firefoxview-opentabs-header"
          ></h3>`,
          () => html`<h3 slot="header">${this.title}</h3>`
        )}
        <div class="fxview-tab-list-container" slot="main">
          <fxview-tab-list
            class="with-context-menu"
            .hasPopup=${"menu"}
            ?compactRows=${this.classList.contains("width-limited")}
            @fxview-tab-list-primary-action=${this.onTabListRowClick}
            @fxview-tab-list-secondary-action=${this.openContextMenu}
            .maxTabsLength=${this.getMaxTabsLength()}
            .tabItems=${this.searchResults || getTabListItems(this.tabs)}
            .searchQuery=${this.searchQuery}
            .showTabIndicators=${true}
            ><view-opentabs-contextmenu slot="menu"></view-opentabs-contextmenu>
          </fxview-tab-list>
        </div>
        ${when(
          this.recentBrowsing,
          () => html` <div
            @click=${this.enableShowAll}
            @keydown=${this.enableShowAll}
            data-l10n-id="firefoxview-show-all"
            ?hidden=${!this.isShowAllLinkVisible()}
            slot="footer"
            tabindex="0"
            role="link"
          ></div>`,
          () =>
            html` <div
              @click=${this.toggleShowMore}
              @keydown=${this.toggleShowMore}
              data-l10n-id="${this.showMore
                ? "firefoxview-show-less"
                : "firefoxview-show-more"}"
              ?hidden=${!this.classList.contains("height-limited") ||
              this.tabs.length <=
                OpenTabsInViewCard.MAX_TABS_FOR_COMPACT_HEIGHT}
              slot="footer"
              tabindex="0"
              role="link"
            ></div>`
        )}
      </card-container>
    `;
  }

  willUpdate(changedProperties) {
    if (changedProperties.has("searchQuery")) {
      this.showAll = false;
      this.cumulativeSearches = this.searchQuery
        ? this.cumulativeSearches + 1
        : 0;
    }
    if (changedProperties.has("searchQuery") || changedProperties.has("tabs")) {
      this.updateSearchResults();
    }
  }

  updateSearchResults() {
    this.searchResults = this.searchQuery
      ? searchTabList(this.searchQuery, getTabListItems(this.tabs))
      : null;
  }
}
customElements.define("view-opentabs-card", OpenTabsInViewCard);

/**
 * A context menu of actions available for open tab list items.
 */
class OpenTabsContextMenu extends MozLitElement {
  static properties = {
    devices: { type: Array },
    triggerNode: { type: Object },
  };

  static queries = {
    panelList: "panel-list",
  };

  constructor() {
    super();
    this.triggerNode = null;
    this.devices = [];
  }

  get logger() {
    return getLogger("OpenTabsContextMenu");
  }

  get ownerViewPage() {
    return this.ownerDocument.querySelector("view-opentabs");
  }

  async fetchDevices() {
    const currentWindow = this.ownerViewPage.getWindow();
    if (currentWindow?.gSync) {
      try {
        await lazy.fxAccounts.device.refreshDeviceList();
      } catch (e) {
        this.logger.warn("Could not refresh the FxA device list", e);
      }
      this.devices = currentWindow.gSync.getSendTabTargets();
    }
  }

  async toggle({ triggerNode, originalEvent }) {
    if (this.panelList?.open) {
      // the menu will close so avoid all the other work to update its contents
      this.panelList.toggle(originalEvent);
      return;
    }
    this.triggerNode = triggerNode;
    await this.fetchDevices();
    await this.getUpdateComplete();
    this.panelList.toggle(originalEvent);
  }

  copyLink(e) {
    placeLinkOnClipboard(this.triggerNode.title, this.triggerNode.url);
    this.ownerViewPage.recordContextMenuTelemetry("copy-link", e);
  }

  closeTab(e) {
    const tab = this.triggerNode.tabElement;
    tab?.ownerGlobal.gBrowser.removeTab(tab);
    this.ownerViewPage.recordContextMenuTelemetry("close-tab", e);
  }

  moveTabsToStart(e) {
    const tab = this.triggerNode.tabElement;
    tab?.ownerGlobal.gBrowser.moveTabsToStart(tab);
    this.ownerViewPage.recordContextMenuTelemetry("move-tab-start", e);
  }

  moveTabsToEnd(e) {
    const tab = this.triggerNode.tabElement;
    tab?.ownerGlobal.gBrowser.moveTabsToEnd(tab);
    this.ownerViewPage.recordContextMenuTelemetry("move-tab-end", e);
  }

  moveTabsToWindow(e) {
    const tab = this.triggerNode.tabElement;
    tab?.ownerGlobal.gBrowser.replaceTabsWithWindow(tab);
    this.ownerViewPage.recordContextMenuTelemetry("move-tab-window", e);
  }

  moveMenuTemplate() {
    const tab = this.triggerNode?.tabElement;
    if (!tab) {
      return null;
    }
    const browserWindow = tab.ownerGlobal;
    const tabs = browserWindow?.gBrowser.visibleTabs || [];
    const position = tabs.indexOf(tab);

    return html`
      <panel-list slot="submenu" id="move-tab-menu">
        ${position > 0
          ? html`<panel-item
              @click=${this.moveTabsToStart}
              data-l10n-id="fxviewtabrow-move-tab-start"
              data-l10n-attrs="accesskey"
            ></panel-item>`
          : null}
        ${position < tabs.length - 1
          ? html`<panel-item
              @click=${this.moveTabsToEnd}
              data-l10n-id="fxviewtabrow-move-tab-end"
              data-l10n-attrs="accesskey"
            ></panel-item>`
          : null}
        <panel-item
          @click=${this.moveTabsToWindow}
          data-l10n-id="fxviewtabrow-move-tab-window"
          data-l10n-attrs="accesskey"
        ></panel-item>
      </panel-list>
    `;
  }

  async sendTabToDevice(e) {
    let deviceId = e.target.getAttribute("device-id");
    let device = this.devices.find(dev => dev.id == deviceId);
    const viewPage = this.ownerViewPage;
    viewPage.recordContextMenuTelemetry("send-tab-device", e);

    if (device && this.triggerNode) {
      await viewPage
        .getWindow()
        .gSync.sendTabToDevice(
          this.triggerNode.url,
          [device],
          this.triggerNode.title
        );
    }
  }

  sendTabTemplate() {
    return html` <panel-list slot="submenu" id="send-tab-menu">
      ${this.devices.map(device => {
        return html`
          <panel-item @click=${this.sendTabToDevice} device-id=${device.id}
            >${device.name}</panel-item
          >
        `;
      })}
    </panel-list>`;
  }

  render() {
    const tab = this.triggerNode?.tabElement;
    if (!tab) {
      return null;
    }

    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/firefoxview/firefoxview.css"
      />
      <panel-list data-tab-type="opentabs">
        <panel-item
          data-l10n-id="fxviewtabrow-close-tab"
          data-l10n-attrs="accesskey"
          @click=${this.closeTab}
        ></panel-item>
        <panel-item
          data-l10n-id="fxviewtabrow-move-tab"
          data-l10n-attrs="accesskey"
          submenu="move-tab-menu"
          >${this.moveMenuTemplate()}</panel-item
        >
        <hr />
        <panel-item
          data-l10n-id="fxviewtabrow-copy-link"
          data-l10n-attrs="accesskey"
          @click=${this.copyLink}
        ></panel-item>
        ${this.devices.length >= 1
          ? html`<panel-item
              data-l10n-id="fxviewtabrow-send-tab"
              data-l10n-attrs="accesskey"
              submenu="send-tab-menu"
              >${this.sendTabTemplate()}</panel-item
            >`
          : null}
      </panel-list>
    `;
  }
}
customElements.define("view-opentabs-contextmenu", OpenTabsContextMenu);

/**
 * Checks if a given tab is within a container (contextual identity)
 *
 * @param {MozTabbrowserTab[]} tab
 *   Tab to fetch container info on.
 * @returns {object[]}
 *   Container object.
 */
function getContainerObj(tab) {
  let userContextId = tab.getAttribute("usercontextid");
  let containerObj = null;
  if (userContextId) {
    containerObj =
      lazy.ContextualIdentityService.getPublicIdentityFromId(userContextId);
  }
  return containerObj;
}

/**
 * Convert a list of tabs into the format expected by the fxview-tab-list
 * component.
 *
 * @param {MozTabbrowserTab[]} tabs
 *   Tabs to format.
 * @returns {object[]}
 *   Formatted objects.
 */
function getTabListItems(tabs) {
  let filtered = tabs?.filter(
    tab => !tab.closing && !tab.hidden && !tab.pinned
  );

  return filtered.map(tab => {
    const url = tab.linkedBrowser?.currentURI?.spec || "";
    return {
      attention: tab.hasAttribute("attention"),
      containerObj: getContainerObj(tab),
      icon: tab.getAttribute("image"),
      muted: tab.hasAttribute("muted"),
      pinned: tab.pinned,
      primaryL10nId: "firefoxview-opentabs-tab-row",
      primaryL10nArgs: JSON.stringify({ url }),
      secondaryL10nId: "fxviewtabrow-options-menu-button",
      secondaryL10nArgs: JSON.stringify({ tabTitle: tab.label }),
      soundPlaying: tab.hasAttribute("soundplaying"),
      tabElement: tab,
      time: tab.lastAccessed,
      title: tab.label,
      titleChanged: tab.hasAttribute("titlechanged"),
      url,
    };
  });
}
