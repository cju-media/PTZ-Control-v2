{
    "name": "PTZ Control v2",
    "version": 1,
    "creationdate": 3820259461,
    "modificationdate": 3846783200,
    "viewrect": [ 20.0, 230.0, 300.0, 500.0 ],
    "autoorganize": 0,
    "hideprojectwindow": 0,
    "showdependencies": 1,
    "autolocalize": 0,
    "contents": {
        "patchers": {
            "PTZcontrolMaster.maxpat": {
                "kind": "patcher",
                "local": 1,
                "toplevel": 1
            },
            "arrayTest.maxpat": {
                "kind": "patcher",
                "local": 1,
                "singleton": {
                    "bootpath": "~/Documents/Programming/PTZ Control/PTZ-Control/patchers",
                    "projectrelativepath": "../PTZ Control/PTZ-Control/patchers"
                }
            },
            "cameraInquire.maxpat": {
                "kind": "patcher",
                "local": 1
            },
            "controlDisplay.maxpat": {
                "kind": "patcher",
                "local": 1
            },
            "menuDisplay.maxpat": {
                "kind": "patcher",
                "local": 1
            },
            "n4m.monitor.maxpat": {
                "kind": "patcher"
            },
            "switchDisplay.maxpat": {
                "kind": "patcher",
                "local": 1
            }
        },
        "media": {
            "xboxoneillustration.png": {
                "kind": "imagefile",
                "local": 1
            }
        },
        "code": {
            "atem-client.js": {
                "kind": "javascript",
                "local": 1
            },
            "fit_jweb_to_bounds.js": {
                "kind": "javascript",
                "local": 1
            },
            "resize_n4m_monitor_patcher.js": {
                "kind": "javascript"
            },
            "atem-bridge.js": {
                "kind": "javascript",
                "local": 1
            },
            "atem.js": {
                "kind": "javascript",
                "local": 1
            },
            "atem_tcp.js": {
                "kind": "javascript",
                "local": 1,
                "singleton": {
                    "bootpath": "~/Documents/Programming/PTZ Control/PTZ-Control/patchers",
                    "projectrelativepath": "../PTZ Control/PTZ-Control/patchers"
                }
            }
        },
        "data": {
            "ptz-cameras.txt": {
                "kind": "textfile",
                "local": 1
            },
            "camDirection.txt": {
                "kind": "textfile",
                "local": 1
            },
            "controlButtons.txt": {
                "kind": "textfile",
                "local": 1
            },
            "discovered-atems.json": {
                "kind": "json",
                "local": 1
            },
            "menuControl.txt": {
                "kind": "textfile",
                "local": 1
            },
            "sanc.txt": {
                "kind": "textfile",
                "local": 1
            },
            "switchButtons.txt": {
                "kind": "textfile",
                "local": 1
            },
            "PTZ_IP.txt": {
                "kind": "textfile",
                "local": 1
            },
            "camIPs.txt": {
                "kind": "textfile",
                "local": 1
            },
            "control1.txt": {
                "kind": "textfile",
                "local": 1,
                "singleton": {
                    "bootpath": "~/Documents/Programming/PTZ Control/PTZ-Control/patchers",
                    "projectrelativepath": "../PTZ Control/PTZ-Control/patchers"
                }
            }
        },
        "externals": {
            "shell.mxo": {
                "kind": "object",
                "local": 1
            },
            "sadam.tcpClient.mxo": {
                "kind": "object",
                "local": 1
            },
            "sadam.tcpSender.mxo": {
                "kind": "object",
                "local": 1
            }
        }
    },
    "layout": {    },
    "searchpath": {    },
    "detailsvisible": 0,
    "amxdtype": 0,
    "readonly": 0,
    "devpathtype": 0,
    "devpath": ".",
    "sortmode": 0,
    "viewmode": 0,
    "includepackages": 0
}