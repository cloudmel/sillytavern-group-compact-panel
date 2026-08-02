import { getContext } from '../../extensions.js';
import { eventSource, event_types } from '../../../script.js';
import { getGroupMembers } from '../../group-chats.js';

const EXTENSION_ROOT_ID = 'group-compact-panel-root';
const EXTENSION_LIST_ID = 'group-compact-panel-list';
const EXTENSION_HANDLE_ID = 'group-compact-panel-handle';
const POSITION_STORAGE_KEY = 'groupCompactPanelPosition';
let isSubscribed = false;
let groupMembersObserver = null;
let dragState = null;

export function init() {
    const root = ensurePanelRoot();
    ensureSubscriptions();
    ensureGroupMembersObserver();
    ensureDragBehavior(root);
    applySavedPosition(root);
    renderPanel();
}

function ensurePanelRoot() {
    let root = document.getElementById(EXTENSION_ROOT_ID);

    if (root) {
        return root;
    }

    root = document.createElement('div');
    root.id = EXTENSION_ROOT_ID;
    root.className = 'group-compact-panel';
    root.setAttribute('data-extension', 'group-compact-panel');

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.id = EXTENSION_HANDLE_ID;
    handle.className = 'group-compact-panel__handle';
    handle.setAttribute('aria-label', 'Drag compact group panel');
    handle.title = 'Drag panel';

    const handleGrip = document.createElement('span');
    handleGrip.className = 'group-compact-panel__handle-grip';
    handleGrip.setAttribute('aria-hidden', 'true');
    handle.appendChild(handleGrip);

    const list = document.createElement('div');
    list.id = EXTENSION_LIST_ID;
    list.className = 'group-compact-panel__list';

    root.append(handle, list);
    document.body.appendChild(root);

    return root;
}

function ensureSubscriptions() {
    if (isSubscribed) {
        return;
    }

    eventSource.on('groupSelected', renderPanel);
    eventSource.on(event_types.GROUP_UPDATED, renderPanel);
    eventSource.on(event_types.CHAT_CHANGED, renderPanel);
    isSubscribed = true;
}

function ensureGroupMembersObserver() {
    if (groupMembersObserver) {
        return;
    }

    groupMembersObserver = new MutationObserver(() => {
        renderPanel();
    });

    const startObserving = () => {
        const groupMembers = document.getElementById('rm_group_members');

        if (!(groupMembers instanceof HTMLElement)) {
            requestAnimationFrame(startObserving);
            return;
        }

        groupMembersObserver.observe(groupMembers, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
            characterData: true,
        });
    };

    startObserving();
}

function renderPanel() {
    const root = ensurePanelRoot();
    const list = root.querySelector(`#${EXTENSION_LIST_ID}`);

    if (!(list instanceof HTMLDivElement)) {
        return;
    }

    const context = getContext();
    const groupId = context.groupId;
    const members = groupId ? getGroupMembers(groupId).filter(Boolean) : [];
    const group = groupId ? context.groups.find((item) => item.id === groupId) : null;
    const disabledMembers = Array.isArray(group?.disabled_members) ? group.disabled_members : [];

    list.replaceChildren();
    root.classList.toggle('group-compact-panel--empty', members.length === 0);

    for (const member of members) {
        list.appendChild(createMemberItem(member, context, disabledMembers.includes(member.avatar)));
    }
}

function createMemberItem(member, context, isDisabled) {
    const item = document.createElement('div');
    item.className = 'group_member group-compact-panel__item';
    item.dataset.id = member.avatar;
    const chid = String(context.characters.indexOf(member));
    item.dataset.chid = chid;
    item.classList.toggle('disabled', isDisabled);
    syncQueueState(item, member, context);

    const avatarButton = document.createElement('button');
    avatarButton.type = 'button';
    avatarButton.className = 'group-compact-panel__avatar-button';
    avatarButton.title = 'View character card';

    const avatar = document.createElement('img');
    avatar.className = 'group-compact-panel__avatar';
    avatar.alt = member.name || 'Character avatar';
    avatar.src = context.getThumbnailUrl('avatar', member.avatar);
    avatar.title = member.avatar;

    avatarButton.appendChild(avatar);

    const actions = document.createElement('div');
    actions.className = 'group-compact-panel__actions';

    const speakButton = createActionButton('speak', 'fa-comment', 'Trigger a message from this character');
    const toggleButton = isDisabled
        ? createActionButton('enable', 'fa-comment-slash', 'Enable automatic replies from this character')
        : createActionButton('disable', 'fa-comment-slash', 'Temporarily disable automatic replies from this character');

    avatarButton.addEventListener('click', (event) => {
        event.preventDefault();
        ensureCharacterManagementPanelOpen();
        proxyStandardGroupAction(member, context, 'view');
    });
    speakButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        proxyStandardGroupAction(member, context, 'speak');
    });
    toggleButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        proxyStandardGroupAction(member, context, isDisabled ? 'enable' : 'disable');
    });

    actions.append(speakButton, toggleButton);
    item.append(avatarButton, actions);
    return item;
}

function createActionButton(action, iconClass, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `group-compact-panel__action right_menu_button fa-solid ${iconClass}`;
    button.dataset.action = action;
    button.title = title;
    button.setAttribute('aria-label', title);
    return button;
}

function proxyStandardGroupAction(member, context, action) {
    const standardMember = findStandardGroupMember(member, context);

    if (!standardMember) {
        return;
    }

    const standardActionButton = Array.from(standardMember.querySelectorAll('.right_menu_button'))
        .find((element) => element.dataset.action === action);

    standardActionButton?.click();
}

function findStandardGroupMember(member, context) {
    const chid = String(context.characters.indexOf(member));

    return Array.from(document.querySelectorAll('#rm_group_members .group_member'))
        .find((element) => {
            if (!(element instanceof HTMLElement)) {
                return false;
            }

            return element.dataset.chid === chid;
        }) ?? null;
}

function ensureCharacterManagementPanelOpen() {
    const rightNavPanel = document.getElementById('right-nav-panel');

    if (!(rightNavPanel instanceof HTMLElement) || rightNavPanel.classList.contains('openDrawer')) {
        return;
    }

    const drawerToggle = document.querySelector('#unimportantYes.drawer-toggle');

    if (drawerToggle instanceof HTMLElement) {
        drawerToggle.click();
    }
}

function ensureDragBehavior(root) {
    if (!(root instanceof HTMLElement) || root.dataset.dragReady === 'true') {
        return;
    }

    root.dataset.dragReady = 'true';
    const handle = root.querySelector(`#${EXTENSION_HANDLE_ID}`);

    if (!(handle instanceof HTMLElement)) {
        return;
    }

    handle.addEventListener('pointerdown', (event) => {
        if (!(event.target instanceof HTMLElement) || event.button !== 0) {
            return;
        }

        const rect = root.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
        };

        root.classList.add('group-compact-panel--dragging');
        handle.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
        }

        const nextLeft = event.clientX - dragState.offsetX;
        const nextTop = event.clientY - dragState.offsetY;
        const position = clampPanelPosition(root, nextLeft, nextTop);
        setPanelPosition(root, position.left, position.top);
        event.preventDefault();
    });

    const stopDragging = (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) {
            return;
        }

        root.classList.remove('group-compact-panel--dragging');
        handle.releasePointerCapture(event.pointerId);
        savePanelPosition(root);
        dragState = null;
    };

    handle.addEventListener('pointerup', stopDragging);
    handle.addEventListener('pointercancel', stopDragging);

    window.addEventListener('resize', () => {
        const rect = root.getBoundingClientRect();
        const position = clampPanelPosition(root, rect.left, rect.top);
        setPanelPosition(root, position.left, position.top);
        savePanelPosition(root);
    });
}

function applySavedPosition(root) {
    if (!(root instanceof HTMLElement)) {
        return;
    }

    const savedPosition = loadSavedPosition();

    if (!savedPosition) {
        return;
    }

    const position = clampPanelPosition(root, savedPosition.left, savedPosition.top);
    setPanelPosition(root, position.left, position.top);
}

function loadSavedPosition() {
    try {
        const rawValue = localStorage.getItem(POSITION_STORAGE_KEY);

        if (!rawValue) {
            return null;
        }

        const parsedValue = JSON.parse(rawValue);

        if (!Number.isFinite(parsedValue?.left) || !Number.isFinite(parsedValue?.top)) {
            return null;
        }

        return parsedValue;
    } catch {
        return null;
    }
}

function savePanelPosition(root) {
    const left = Number(root.style.left.replace('px', ''));
    const top = Number(root.style.top.replace('px', ''));

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return;
    }

    try {
        localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ left, top }));
    } catch {
        // Ignore storage errors and keep the panel usable for the current session.
    }
}

function setPanelPosition(root, left, top) {
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = 'auto';
}

function clampPanelPosition(root, left, top) {
    const maxLeft = Math.max(8, window.innerWidth - root.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - root.offsetHeight - 8);

    return {
        left: Math.min(Math.max(8, left), maxLeft),
        top: Math.min(Math.max(8, top), maxTop),
    };
}

function syncQueueState(item, member, context) {
    const standardMember = findStandardGroupMember(member, context);

    if (!(standardMember instanceof HTMLElement)) {
        return;
    }

    item.classList.toggle('is_active', standardMember.classList.contains('is_active'));
    item.classList.toggle('is_queued', standardMember.classList.contains('is_queued'));

    const queuePosition = standardMember.querySelector('.queue_position')?.textContent?.trim();
    const queueValue = Number(queuePosition);

    if (Number.isInteger(queueValue) && queueValue > 0) {
        item.dataset.queuePosition = String(queueValue);
        item.style.setProperty('--group-compact-panel-queue-hue', String(getQueueHue(queueValue)));
    } else {
        delete item.dataset.queuePosition;
        item.style.removeProperty('--group-compact-panel-queue-hue');
    }
}

function getQueueHue(queuePosition) {
    if (queuePosition <= 1) {
        return 120;
    }

    const queueHues = {
        2: 50,
        3: 205,
        4: 280,
        5: 12,
    };

    return queueHues[queuePosition] ?? 205;
}
