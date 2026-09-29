fresh();
          }
        });
      }
    } catch (e) {}

    console.log('[room-picker] v' + VERSION + ' ready');
  }

  window.QamarRoomPicker = {
    version: VERSION,
    refresh: refresh,
    open: function () {
      if (window.QamarSidebar && window.QamarSidebar.open) {
        window.QamarSidebar.open('sidebar-rooms');
      }
      setTimeout(refresh, 60);
    },
    getRooms: function () { return St.currentRooms.slice(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 150);
  }
})();
