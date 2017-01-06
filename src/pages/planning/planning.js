import Vue from 'vue';
import VueResource from 'vue-resource';
import draggable from 'vuedraggable';
import { ScaleLoader } from 'vue-spinner';

import SemesterHelper from '../../helpers/SemesterHelper';
import UserHelper from '../../helpers/UserHelper';

import HttpConfig from '../../rest/HttpConfig';
import Endpoints from '../../rest/Endpoints';

/*
 * Tell Vue that we want to use some plugins:
 *   - 'vue-resource' provides http services
 *
 * documentations:
 *   - https://github.com/pagekit/vue-resource    <-- doesn't update view-model
 *   - http://sagalbot.github.io/vue-sortable     <-- updates view-model correctly.
 */
Vue.use(VueResource);

/*
 * ------------ BE AWARE ------------
 *   Actually, vue-sortable does not work yet with vue 2.0 [29.11.2016].
 *   For that reason, I had to patch the node-module manually corresponding to that suggestion:
 *
 *      https://github.com/sagalbot/vue-sortable/pull/13/files
 *
 *  This means that if you run "npm install", you have to add that workaround until it gets
 *  merged into the official vue-sortable repository (and published via version update).
 *
 *
 *
 *  ------------ BE AWARE 2 ----------
 *  Vue-Sortable did nothing than problems when trying to synchronize the view-model with the displayed data.
 *  For that, we now use 'draggable', a Vue 2.0 - compliant addon that exactly solves the problem of the
 *  synchronisation between view changes due to drag-and-drop functionality and view-model data.
 *
 *      https://github.com/SortableJS/Vue.Draggable
 *
 *  The options for that framework are the same than for the Sortable.js framework and can be found under:
 *
 *      https://github.com/RubaXa/Sortable#options
 *
 *  This means that the patch mentioned above is not further necessary. Anyway, I'll delete that hint
 *  after finishing the 'planning' page to not loosing some maybe-relevant information.
 *
 *
 *  How to deal with Vue event bus:
 *      https://www.sitepoint.com/up-and-running-vue-js-2-0/
 */

let Planning = {
  template: require('./planning.html'),

  data: function () {
    return {
      upcomingSemester: UserHelper.getUser().upcomingsemester,
      totalSemesters: UserHelper.getUser().totalsemester,
      semesters: [],
      modules: {
        proposals: [],
        completions: [],
        bookings: [],
        plannings: []
      },
      baseConfig: {
        handle: '.dnd-handler',
        draggable: '.list-group-item',
        animation: 150
      },
      types: {
        PROPOSALS: 'proposals',
        COMPLETIONS: 'completions',
        BOOKINGS: 'bookings',
        PLANNINGS: 'plannings'
      },
      searches: {
        module: ''
      },
      colMdSizeCssClass: '',
      ready: false
    }
  },

  created: function () {
    let _self = this;

    let queryUser = ['?filter=(student_id="', UserHelper.getUser().uid, '")'].join('');
    let queryUserAndRelated = [queryUser, '&related=courseexecution_by_courseexecution_ID'].join('');

    Promise.all([
      this.$http.get(Endpoints.COURSE, HttpConfig), // proposals
      this.$http.get(Endpoints.RESULT_VIEW + queryUser, HttpConfig), // completions
      this.$http.get(Endpoints.STUDENT_COURSE_EXECUTION + queryUserAndRelated + '', HttpConfig), // bookings
      this.$http.get(Endpoints.PLANNING + queryUser, HttpConfig), // plannings
    ])
    .then(function (responses) {
      _self.modules.proposals = responses[0].body.resource; // comes with all information
      _self.modules.proposals.forEach(prop => {
        prop.id_of_the_module = prop.uid;
      });

      _self.modules.completions = responses[1].body.resource; // comes with all information

      // Remove all completed modules from the proposals.
      _self.modules.completions.forEach(completion => {
        _self.modules.proposals.splice(_self.modules.proposals.indexOf(completion), 1);
      });

      /* The 'bookings' view only delivers the foreign keys of the concerned modules.
       * with that FK, we can find the real module in the 'proposals' array
       * and move that item to the 'bookings' array.
       */
      responses[2].body.resource.forEach(booking => {
        _self.modules.proposals.filter(proposal => {
          return proposal.uid === booking.courseexecution_by_courseexecution_ID.course_id;
        }).forEach(prop => {
          _self.modules.proposals.splice(_self.modules.proposals.indexOf(prop), 1);

          // transfer some infos from proposal to bookings object.
          let bkn = booking.courseexecution_by_courseexecution_ID;
          bkn.ects = prop.ects;
          bkn.title = prop.name_de;

          _self.modules.bookings.push(bkn);
        });
      });

      /* The 'plannings' view only delivers the foreign keys of the concerned modules.
       * with that fk, we can find the real module in the 'proposals' array
       * and move that item to the 'plannings' array.
       */
      responses[3].body.resource.forEach(planning => {
        _self.modules.proposals.filter(proposal => {
          if (proposal.uid === planning.course_ID) {
            proposal.semester = planning.semester; // transfer semester information
            return true;
          }
        }).forEach(prop => {
          _self.modules.proposals.splice(_self.modules.proposals.indexOf(prop), 1);
          prop.planning_id = planning.uid;
          _self.modules.plannings.push(prop);
        });
      });

      /*
       * calculate the initial starting semester, then calculate each upcoming semester
       * (from then up to the end) and add them to the semesters arrray which builds the time lapse.
       */
      let initialSemester = SemesterHelper.subtract(SemesterHelper.NOW_REFERENCE, (_self.upcomingSemester - 1));
      for (let i = 1; i <= _self.totalSemesters; i++) {
        let sem = SemesterHelper.add(initialSemester.label, i);
        _self.semesters.push(sem);
      }

      _self.ready = true;
    }, (response) => {
      window.console.log(response);
    });


    /*
     * That's a bit ugly, but we have to calculate the number of required columns.
     * The reason is that bootstrap does not provide 'col-md-*' definitions for each number between 1 and 12 so
     * we had to define our 'special classes' ourselves.
     */
    this.colMdSizeCssClass = ['col-md', (this.totalSemesters + 1)].join('-');
  },

  mounted: function () {
    let _self = this;

    this.$el.addEventListener('add', function (event) {

      let origin = event.from.attributes['data-module-type'].value;
      let target = event.target.attributes['data-module-type'].value;
      let moduleId = parseInt(event.item.attributes['data-module-id'].value);
      let semester = parseInt(event.target.attributes['data-semester'].value);

      // set the new semester label to the moved element.
      let module = _self.modules[origin].filter(item => {
        if (item.id_of_the_module === moduleId) {
          return item;
        }
      })[0];
      module.semester = semester;
      let planningId = module.planning_id;

      let resource = {
        "student_ID": UserHelper.getUser().uid,
        "semester": module.semester,
        "course_ID": moduleId
      };

      /*
       * There are three possibilities that are expected to happen:
       *   1) module newly moved from proposal to planning  --> add that module to the planning table
       *   2) module moved back from planning to proposal   --> remove that module from the planning table
       *   3) moved a module between two planning semesters --> update the record with the new semester
       *
       */
      if (origin === _self.types.PROPOSALS && target === _self.types.PLANNINGS) {
        // case 1)
        _self.$http.post(Endpoints.PLANNING, {"resource": resource}, HttpConfig).then((response) => {
          console.log("created planning for module " + moduleId);
          module.planning_id = response.body.resource[0].uid;
        }, (response) => {
          console.error(response);
        })

      } else if (origin === _self.types.PLANNINGS && target === _self.types.PROPOSALS) {
        // case 2)
        _self.$http.delete(Endpoints.PLANNING + "/" + planningId, HttpConfig).then((response) => {
          console.log("deleted planning " + planningId);
        }, (response) => {
          console.error(response);
        })

      } else if (origin === target && origin === _self.types.PLANNINGS) {
        // case 3)
        _self.$http.patch(Endpoints.PLANNING + "/" + planningId, resource, HttpConfig).then((response) => {
          console.log("patched planning " + planningId);
        }, (response) => {
          console.error(response);
        })
      } else {
        window.console.log("oops, that should never happen...");
      }

      /*
       * TODO:
       *    ECTS Punkte je Semester summieren und anzeigen.
       */
    });
  },


  computed: {
    proposalConfig: function () {
      return Object.assign({
        // Only allow that proposals are put to plan semesters.
        group: {
          name: this.types.PROPOSALS,
          put: [this.types.PLANNINGS]
        },
      }, this.baseConfig);
    },

    planningConfig: function () {
      return Object.assign({
        // Planned modules can be put either to another plan semester or back to proposals.
        group: {
          name: this.types.PLANNINGS,
          put: [this.types.PLANNINGS, this.types.PROPOSALS]
        }
      }, this.baseConfig);
    },

    orderedSemesters: function() {
      return this.semesters.sort(function(sem1, sem2) {
        return sem1.label > sem2.label;
      });
    },

    getUpcomingSemesterLabel: function() {
      return SemesterHelper.NOW_REFERENCE;
    },

    getAfterNextSemesterLabel: function() {
      return SemesterHelper.add(SemesterHelper.NOW_REFERENCE, 1);
    },

    filteredProposals: function () {
      return this.modules.proposals.filter(item => {
        if (item.name_de.toLowerCase().indexOf(this.searches.module.trim().toLowerCase()) > -1) {
          return item;
        }
      });
    }
  },

  methods: {
    filterModules: function(target, semester) {
      return this.modules[target].filter(module => {
        if (module.semester === semester.label) {
          return module;
        }
      });
    },

    totalEcts: function() {
      let ects = 0;
      this.modules.completions.forEach(completion => {
        ects += completion.ects;
      });
      this.modules.bookings.forEach(booking => {
        ects += booking.ects;
      });
      this.modules.plannings.forEach(planning => {
        ects += planning.ects;
      });
      return ects;
    },

    calculateEcts: function(semester) {
      let ects = 0;
      this.modules.completions.forEach(completion => {
        if (completion.semester === semester.label) {
          ects += completion.ects;
        }
      });
      this.modules.bookings.forEach(booking => {
        if (booking.semester === semester.label) {
          ects += booking.ects;
        }
      });
      this.modules.plannings.forEach(planning => {
        if (planning.semester === semester.label) {
          ects += planning.ects;
        }
      });
      return ects;
    }
  },

  components: { draggable, SemesterHelper, ScaleLoader }

};

export default Planning;
